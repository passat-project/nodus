/* eslint-disable nodus-internal/max-lines-warn -- API счетов (#630): шесть операций окна правила в одном сервисе */
import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  numberEmptySegments,
  numberPeriodKey,
  type NumberContainerMissingReason,
  numberCountKey,
  resolveNumberContainers,
  type NumberBackfillGroup,
  type NumberBackfillPreview,
  type NumberContainer,
  type NumberContainerHit,
  type NumberCount,
  type NumberCountsResponse,
  type NumberCoverageResult,
  type NumberHostAssignment,
  type NumberHostKind,
  type NumberPreviewResult,
  type NumberSeriesRule,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  NUMBER_SERIES_STORE,
  type NumberSeriesData,
  type NumberSeriesStore,
} from '../../workflows/ports/number-series.port.js';
import { DefinitionsRepository } from '../definitions/definitions.repository.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';
import {
  momentNow,
  nameOfSegment,
  participantsOf,
  placeOf,
  readerOf,
  render,
  sampleOf,
} from './numbering-api.helpers.js';
import type { NumberActor, NumberHostRecord } from '../ports/number-host.port.js';
import { NUMBER_HOST_REGISTRY, type NumberHostRegistry } from '../ports/number-host.port.js';
import { NUMBER_ISSUE, type NumberIssue } from '../ports/number-issue.port.js';
import { NumberRefService } from './number-ref.service.js';

/** Счётчик атрибута с правилом — то, что нужно API счетов. */
interface Counter {
  definition: FieldDefinitionRow;
  series: NumberSeriesData;
  rule: NumberSeriesRule;
}

/**
 * API счётчиков (#630, модель v3): охват правила, «Проверка на записи»,
 * «Текущие счета», «Следующий номер» (только вперёд), выдача существующим и
 * номера одной записи. Всё — серверное зеркало мок-мира
 * (`numbering-handlers.ts`); правила отказов те же.
 */
@Injectable()
export class NumberingApiService {
  constructor(
    private readonly definitions: DefinitionsRepository,
    @Inject(NUMBER_SERIES_STORE) private readonly series: NumberSeriesStore,
    @Inject(NUMBER_ISSUE) private readonly issue: NumberIssue,
    @Inject(NUMBER_HOST_REGISTRY) private readonly hosts: NumberHostRegistry,
    private readonly refs: NumberRefService,
  ) {}

  async coverage(
    tx: TransactionClient,
    actor: NumberActor,
    rule: NumberSeriesRule,
    participantTypeIds: readonly string[],
  ): Promise<NumberCoverageResult> {
    const hosts = await this.hosts.list(tx, actor, participantTypeIds);
    const definitions = await this.definitions.list(tx);
    const outside: { host: NumberHostRecord; reason: NumberContainerMissingReason }[] = [];
    for (const host of hosts) {
      const resolved = resolveNumberContainers(rule.containers, placeOf(host, definitions));
      if (!resolved.ok) outside.push({ host, reason: resolved.reason });
    }
    return {
      total: hosts.length,
      inside: hosts.length - outside.length,
      outside: outside
        .filter((entry) => entry.host.visible)
        .slice(0, 5)
        .map((entry) => sampleOf(entry.host, entry.reason)),
      hiddenOutside: outside.filter((entry) => !entry.host.visible).length,
    };
  }

  async preview(
    tx: TransactionClient,
    actor: NumberActor,
    body: {
      definitionId?: string;
      rule: NumberSeriesRule;
      participantTypeIds: readonly string[];
      host: { kind: NumberHostKind; id: string };
    },
  ): Promise<NumberPreviewResult> {
    const record = await this.hosts.find(tx, actor, body.host.kind, body.host.id);
    if (!record) throw DomainException.notFound('Number host not found');
    if (!body.participantTypeIds.includes(record.typeId)) {
      return { ok: false, hostName: record.name, reason: 'not_participant' };
    }
    const place = await this.placeOfRecord(tx, record);
    const resolved = resolveNumberContainers(body.rule.containers, place);
    if (!resolved.ok) return { ok: false, hostName: record.name, reason: resolved.reason };
    const definitions = await this.definitions.list(tx);
    const reader = readerOf(record, definitions);
    const counter =
      body.definitionId && (await this.counterOf(tx, body.definitionId))
        ? await this.peek(tx, body.definitionId, resolved.hits)
        : { value: body.rule.startValue };
    const existing = body.definitionId ? record.target.sources.self[body.definitionId] : undefined;
    return {
      ok: true,
      hostName: record.name,
      containers: await this.refs.refs(tx, resolved.hits, body.rule.containers, actor),
      nextDisplay: render(body.rule, counter.value, reader),
      alreadyAssigned: typeof existing === 'string' && existing.length > 0 ? existing : null,
      emptySegments: numberEmptySegments(body.rule.template, reader).map((segment) =>
        nameOfSegment(segment, definitions),
      ),
    };
  }

  async counts(
    tx: TransactionClient,
    definitionId: string,
    actor: NumberActor,
    q: string,
  ): Promise<NumberCountsResponse> {
    const counter = await this.counterOrThrow(tx, definitionId);
    const rows = await this.series.counters(tx, counter.series.id);
    const needle = q.trim().toLowerCase();
    const items: NumberCount[] = [];
    for (const row of rows) {
      const containers = await this.refs.refs(tx, row.hits, counter.rule.containers, actor);
      const lastDisplay =
        row.lastValue >= counter.rule.startValue ? render(counter.rule, row.lastValue) : null;
      items.push({
        containers,
        periodKey: row.periodKey,
        lastValue: row.lastValue,
        lastDisplay,
        nextValue: row.lastValue + counter.rule.step,
        nextDisplay: render(counter.rule, row.lastValue + counter.rule.step),
      });
    }
    const filtered = needle
      ? items.filter((item) =>
          item.containers.some((container) => container.name.toLowerCase().includes(needle)),
        )
      : items;
    const issued =
      (await this.series.issuedCounts(tx, [counter.series.id])).get(counter.series.id) ?? 0;
    return {
      items: filtered,
      nextCursor: null,
      totals: { counts: items.length, issued },
    };
  }

  async setNext(
    tx: TransactionClient,
    definitionId: string,
    actor: NumberActor,
    body: { containerIds: readonly string[]; nextValue: number },
  ): Promise<NumberCountsResponse> {
    const counter = await this.counterOrThrow(tx, definitionId);
    const hits = await this.hitsOfIds(tx, counter.rule, body.containerIds, actor);
    if (!hits) {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'containerIds do not match the rule',
        {},
      );
    }
    await this.series.setNext(tx, counter.series.id, { hits, nextValue: body.nextValue });
    return this.counts(tx, definitionId, actor, '');
  }

  async backfillPreview(
    tx: TransactionClient,
    definitionId: string,
    actor: NumberActor,
  ): Promise<NumberBackfillPreview> {
    const counter = await this.counterOrThrow(tx, definitionId);
    const { items, blocked } = await this.backfillPlan(tx, actor, counter);
    const groups = new Map<
      string,
      {
        hits: NumberContainerHit[];
        count: number;
        first: number;
        last: number;
        record: NumberHostRecord;
        readerRecord: NumberHostRecord | null;
      }
    >();
    for (const item of items) {
      const key = numberCountKey(
        item.hits.map((hit) => hit.id),
        '',
      );
      const group = groups.get(key);
      if (!group) {
        groups.set(key, {
          hits: item.hits,
          count: 1,
          first: item.seq,
          last: item.seq,
          record: item.host,
          readerRecord: item.host.visible ? item.host : null,
        });
      } else {
        group.count += 1;
        group.last = item.seq;
        if (!group.readerRecord && item.host.visible) group.readerRecord = item.host;
      }
    }
    const out: NumberBackfillGroup[] = [];
    for (const group of [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 20)) {
      out.push({
        containers: await this.refs.refs(tx, group.hits, counter.rule.containers, actor),
        count: group.count,
        firstDisplay: render(
          counter.rule,
          group.first,
          readerOf(group.record, await this.definitions.list(tx)),
        ),
        lastDisplay: render(
          counter.rule,
          group.last,
          readerOf(group.record, await this.definitions.list(tx)),
        ),
      });
    }
    return {
      total: items.length,
      groups: out,
      blocked: blocked
        .filter((entry) => entry.host.visible)
        .slice(0, 5)
        .map((entry) => sampleOf(entry.host, entry.reason)),
      blockedTotal: blocked.length,
      emptyParts: items.filter((item) => item.empty).length,
    };
  }

  async backfill(
    txRunner: { run<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> },
    definitionId: string,
    actor: NumberActor,
    body: { expectedTotal: number; confirmEmptyNumberParts?: true },
  ): Promise<{ issued: number }> {
    const counter = await txRunner.run((tx) => this.counterOrThrow(tx, definitionId));
    const plan = await txRunner.run((tx) => this.backfillPlan(tx, actor, counter));
    if (plan.items.length !== body.expectedTotal) {
      throw new DomainException(ErrorCode.NUMBER_BACKFILL_STALE, 'Records changed since preview', {
        total: plan.items.length,
      });
    }
    const groups = new Map<string, typeof plan.items>();
    for (const item of plan.items) {
      const key = numberCountKey(
        item.hits.map((hit) => hit.id),
        numberPeriodKey(counter.rule.period, momentNow()),
      );
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    let issued = 0;
    for (const items of groups.values()) {
      issued += await txRunner.run(async (tx) => {
        let count = 0;
        for (const item of items) {
          if (item.empty && !body.confirmEmptyNumberParts) continue;
          const assigned = await this.series.next(tx, counter.series.id, {
            hits: item.hits,
            field: readerOf(item.host, await this.definitions.list(tx)),
            host: {
              kind: item.host.kind,
              id: item.host.id,
              fieldId: definitionId,
              actorId: actor.id,
              source: 'backfill',
            },
          });
          await this.hosts.writeNumber(
            tx,
            item.host.kind,
            item.host.id,
            definitionId,
            assigned.display,
          );
          count += 1;
        }
        return count;
      });
    }
    return { issued };
  }

  async hostAssignments(
    tx: TransactionClient,
    actor: NumberActor,
    kind: NumberHostKind,
    id: string,
  ): Promise<{ items: NumberHostAssignment[] }> {
    const record = await this.hosts.find(tx, actor, kind, id);
    if (!record) throw DomainException.notFound('Number host not found');
    return { items: await this.issue.hostAssignments(tx, kind, id, actor) };
  }

  private async counterOf(tx: TransactionClient, id: string): Promise<Counter | null> {
    const definition = await this.definitions.findById(id, tx);
    if (definition?.type !== 'counter' || !definition.numberSeriesId) return null;
    const series = await this.series.byId(tx, definition.numberSeriesId);
    if (!series) return null;
    return {
      definition,
      series,
      rule: {
        containers: series.containers,
        period: series.period,
        template: series.template,
        startValue: series.startValue,
        step: series.step,
      },
    };
  }

  private async counterOrThrow(tx: TransactionClient, id: string): Promise<Counter> {
    const counter = await this.counterOf(tx, id);
    if (!counter) throw DomainException.notFound('Counter not found', { definitionId: id });
    return counter;
  }

  private async peek(
    tx: TransactionClient,
    definitionId: string,
    hits: readonly NumberContainerHit[],
  ): Promise<{ value: number }> {
    const counter = await this.counterOrThrow(tx, definitionId);
    const row = await this.series.counter(tx, counter.series.id, hits);
    return { value: row ? row.lastValue + counter.rule.step : counter.rule.startValue };
  }

  private async backfillPlan(
    tx: TransactionClient,
    actor: NumberActor,
    counter: Counter,
  ): Promise<{
    items: { host: NumberHostRecord; hits: NumberContainerHit[]; seq: number; empty: boolean }[];
    blocked: { host: NumberHostRecord; reason: NumberContainerMissingReason }[];
  }> {
    const participants = participantsOf(counter.definition);
    const hosts = await this.hosts.list(tx, actor, participants);
    const definitions = await this.definitions.list(tx);
    const counters = await this.series.counters(tx, counter.series.id);
    const lastByKey = new Map(
      counters.map((row) => [
        numberCountKey(
          row.hits.map((h) => h.id),
          row.periodKey,
        ),
        row.lastValue,
      ]),
    );
    const nextByKey = new Map<string, number>();
    const items: {
      host: NumberHostRecord;
      hits: NumberContainerHit[];
      seq: number;
      empty: boolean;
    }[] = [];
    const blocked: { host: NumberHostRecord; reason: NumberContainerMissingReason }[] = [];
    const ordered = [...hosts].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    for (const host of ordered) {
      const value = host.target.sources.self[counter.definition.id];
      if (typeof value === 'string' && value.length > 0) continue;
      const place = await this.placeOfRecord(tx, host);
      const resolved = resolveNumberContainers(counter.rule.containers, place);
      if (!resolved.ok) {
        blocked.push({ host, reason: resolved.reason });
        continue;
      }
      const periodKey = numberPeriodKey(counter.rule.period, momentNow());
      const key = numberCountKey(
        resolved.hits.map((hit) => hit.id),
        periodKey,
      );
      const seq =
        nextByKey.get(key) ??
        (lastByKey.get(key) ?? counter.rule.startValue - counter.rule.step) + counter.rule.step;
      nextByKey.set(key, seq + counter.rule.step);
      items.push({
        host,
        hits: resolved.hits,
        seq,
        empty: numberEmptySegments(counter.rule.template, readerOf(host, definitions)).length > 0,
      });
    }
    return { items, blocked };
  }

  private async placeOfRecord(tx: TransactionClient, host: NumberHostRecord) {
    const definitions = await this.definitions.list(tx);
    return placeOf(host, definitions);
  }

  private async hitsOfIds(
    tx: TransactionClient,
    rule: NumberSeriesRule,
    ids: readonly string[],
    actor: NumberActor,
  ): Promise<NumberContainerHit[] | null> {
    if (ids.length !== rule.containers.length) return null;
    const out: NumberContainerHit[] = [];
    for (const [index, container] of rule.containers.entries()) {
      const id = ids[index]!;
      out.push(await this.hitOf(tx, container, id, actor));
    }
    return out;
  }

  /** Значение условия по id: существование проверяется реальным актёром
   *  (#630, security-ревью) — мусорный uuid не создаёт висячий счёт. */
  private async hitOf(
    tx: TransactionClient,
    container: NumberContainer,
    id: string,
    actor: NumberActor,
  ): Promise<NumberContainerHit> {
    const hit = (entity: NumberContainerHit['entity']): NumberContainerHit => ({ entity, id });
    const ensure = async (entity: NumberContainerHit['entity']) => {
      const ref = await this.hosts.resolveRef(tx, hit(entity), actor);
      if (!ref) {
        throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Container does not exist', {
          container: container.kind,
          id,
        });
      }
      return hit(entity);
    };
    switch (container.kind) {
      case 'folder':
        return ensure('node');
      case 'parent_folder': {
        const node = await this.hosts.resolveRef(tx, hit('node'), actor);
        if (node) return hit('node');
        const project = await this.hosts.resolveRef(tx, hit('project'), actor);
        if (project) return hit('project');
        throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Container does not exist', {
          container: container.kind,
          id,
        });
      }
      case 'project':
        return ensure('project');
      case 'project_type':
        return ensure('project_type');
      case 'portfolio':
        return ensure('portfolio');
      case 'parent_task':
        return ensure('task');
      case 'field':
        return hit('value');
      case 'record_type':
        return hit('type');
    }
  }
}
