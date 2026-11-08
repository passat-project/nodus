import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import {
  numberEmptySegments,
  renderNumberTemplate,
  resolveNumberContainers,
  type NumberContainerHit,
  type NumberFieldSegment,
  type NumberHostAssignment,
  type NumberHostKind,
  type NumberMoment,
  type NumberPlace,
  type NumberSeriesRule,
  type NumberTemplateFieldReader,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { companyDay, companyMonth, companyYear } from '../../../core/time/company-time.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import { DefinitionsRepository } from '../definitions/definitions.repository.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';
import {
  NUMBER_SERIES_STORE,
  type NumberSeriesData,
  type NumberSeriesStore,
} from '../../workflows/ports/number-series.port.js';
import type { NumberActor, NumberTarget } from '../ports/number-host.port.js';
import {
  type EmptySegmentInfo,
  type NumberIssue,
  type NumberIssueOptions,
  type NumberPlan,
  type NumberingFailure,
} from '../ports/number-issue.port.js';
import { NumberRefService } from './number-ref.service.js';

/** Источник поля-вставки → значения записи, откуда берётся текст. */
interface PlanContext {
  byId: ReadonlyMap<string, FieldDefinitionRow>;
  byNumber: ReadonlyMap<number, FieldDefinitionRow>;
  place: NumberPlace;
  reader: NumberTemplateFieldReader;
}

interface PendingNumber {
  fieldId: string;
  series: NumberSeriesData;
  hits: NumberContainerHit[];
}

/**
 * Движок выдачи номеров счётчиков (#630, модель v3) — серверное зеркало
 * мок-мира (`numbering-create.ts`, `numbering-store.ts`). План проверяет
 * ВСЕ номера действия до выдачи: нет места счёта — 409
 * `NUMBER_CONTAINER_MISSING`, пустое поле-вставка — 409
 * `NUMBER_SEGMENT_EMPTY`; ничего не потрачено. Выдача — в транзакции
 * действия, один номер атрибута на запись (UNIQUE журнала). Порядок выдачи —
 * по id атрибута, как в моке: без встречных блокировок.
 */
@Injectable()
export class NumberIssueService implements NumberIssue {
  constructor(
    private readonly definitions: DefinitionsRepository,
    @Inject(NUMBER_SERIES_STORE) private readonly series: NumberSeriesStore,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    private readonly refs: NumberRefService,
  ) {}

  async plan(
    tx: TransactionClient,
    fieldIds: readonly string[],
    target: NumberTarget,
    opts: NumberIssueOptions,
  ): Promise<NumberPlan> {
    if (fieldIds.length === 0) return { ok: true, issue: async () => ({}) };
    const context = await this.context(tx, target);
    const pending: PendingNumber[] = [];
    for (const fieldId of [...fieldIds].sort()) {
      const definition = context.byId.get(fieldId);
      if (definition?.type !== 'counter' || !definition.numberSeriesId) continue;
      const series = await this.series.byId(tx, definition.numberSeriesId);
      if (!series) continue;
      // Кнопка/создание не выдают номер атрибуту, не привязанному к этому
      // типу записи (#630, security-ревью): иначе серия тратится в чужом счёте.
      const targetKind = targetKindOf(target.host);
      const bound = definition.bindings.some(
        (binding) => binding.targetKind === targetKind && binding.targetId === target.typeId,
      );
      if (!bound) {
        throw new DomainException(
          ErrorCode.NUMBER_TRIGGER_INVALID,
          'Number field is not bound to this record type',
          { fieldId, typeId: target.typeId },
        );
      }
      const resolved = resolveNumberContainers(series.containers, context.place);
      if (!resolved.ok) {
        return {
          ok: false,
          failure: {
            kind: 'missing',
            fieldId,
            fieldName: definition.name,
            reason: resolved.reason,
            index: resolved.index,
            name: await this.refs.conditionName(tx, series.containers, resolved.index),
          } satisfies NumberingFailure,
        };
      }
      const empty = numberEmptySegments(series.template, context.reader);
      if (empty.length > 0 && !opts.confirmEmpty) {
        return {
          ok: false,
          failure: {
            kind: 'empty',
            fieldId,
            fieldName: definition.name,
            segments: empty.map((segment) => segmentInfo(context, segment)),
            example: renderNumberTemplate(series.template, {
              seq: series.startValue,
              ...momentNow(),
              field: context.reader,
            }),
          } satisfies NumberingFailure,
        };
      }
      pending.push({ fieldId, series, hits: resolved.hits });
    }
    return {
      ok: true,
      issue: async (issueTx, hostId) => {
        const out: Record<string, string> = {};
        for (const item of pending) {
          const issued = await this.series.next(issueTx, item.series.id, {
            hits: item.hits,
            field: context.reader,
            host: {
              kind: opts.hostKind,
              id: hostId,
              fieldId: item.fieldId,
              actorId: opts.actorId ?? null,
              source: opts.source,
              sourceLabel: opts.sourceLabel ?? null,
            },
          });
          out[item.fieldId] = issued.display;
        }
        return out;
      },
    };
  }

  async planOnCreate(
    tx: TransactionClient,
    target: NumberTarget,
    opts: {
      source: 'create' | 'type_change';
      values: Readonly<Record<string, unknown>>;
      confirmEmpty?: boolean;
      actorId?: string | null;
    },
  ): Promise<NumberPlan> {
    if (!target.typeId) return { ok: true, issue: async () => ({}) };
    const targetKind = targetKindOf(target.host);
    const definitions = await this.definitions.list(tx);
    const fieldIds = definitions
      .filter(
        (row) =>
          row.type === 'counter' &&
          row.numberSeriesId !== null &&
          row.bindings.some(
            (binding) =>
              binding.targetKind === targetKind &&
              binding.targetId === target.typeId &&
              binding.numberOnCreate,
          ),
      )
      .filter((row) => isEmptyValue(opts.values[row.id]))
      .map((row) => row.id);
    return this.plan(tx, fieldIds, target, {
      hostKind: target.host,
      source: opts.source,
      confirmEmpty: opts.confirmEmpty,
      actorId: opts.actorId ?? null,
    });
  }

  preview(rule: NumberSeriesRule): string {
    return renderNumberTemplate(rule.template, {
      seq: rule.startValue,
      ...momentNow(),
      field: () => '…',
    });
  }

  async hostAssignments(
    tx: TransactionClient,
    kind: NumberHostKind,
    id: string,
    actor: NumberActor,
  ): Promise<NumberHostAssignment[]> {
    const rows = await this.series.assignments(tx, kind, id);
    const seriesCache = new Map<string, NumberSeriesData | null>();
    const actorIds = [...new Set(rows.flatMap((row) => (row.actorId ? [row.actorId] : [])))];
    const people = actorIds.length > 0 ? await this.profiles.findRefs(actorIds, tx) : [];
    const nameById = new Map(people.map((person) => [person.id, person.displayName]));
    const out: NumberHostAssignment[] = [];
    for (const row of rows) {
      if (!row.fieldId) continue;
      let series = seriesCache.get(row.seriesId);
      if (series === undefined) {
        series = await this.series.byId(tx, row.seriesId);
        seriesCache.set(row.seriesId, series);
      }
      out.push({
        fieldId: row.fieldId,
        display: row.display,
        containers: await this.refs.refs(tx, row.hits, series?.containers ?? [], actor),
        periodKey: row.periodKey,
        assignedAt: row.assignedAt.toISOString(),
        actorName: row.actorId ? (nameById.get(row.actorId) ?? null) : null,
        source: row.source,
        sourceLabel: row.sourceLabel,
      });
    }
    return out;
  }

  /** Определения, значения компании и место записи — один раз на план. */
  private async context(tx: TransactionClient, target: NumberTarget): Promise<PlanContext> {
    const definitions = await this.definitions.list(tx);
    const byId = new Map(definitions.map((row) => [row.id, row]));
    const byNumber = new Map(definitions.map((row) => [row.number, row]));
    const companyByNumber = new Map(
      definitions
        .filter((row) => row.isCompany && row.companyValue !== null)
        .map((row) => [row.number, String(row.companyValue!.value)] as const),
    );
    const place: NumberPlace = {
      host: target.host,
      typeId: target.typeId,
      folders: target.folders,
      projectId: target.projectId,
      portfolioId: target.portfolioId,
      projectTypeId: target.projectTypeId,
      parentTaskId: target.parentTaskId,
      fieldValue: (fieldNumber) => valueOf(target.sources.self, byNumber.get(fieldNumber)?.id),
    };
    const reader: NumberTemplateFieldReader = (segment) => {
      if (segment.source === 'company') return companyByNumber.get(segment.fieldNumber) ?? '';
      const source = sourceValues(target, segment);
      return valueOf(source, byNumber.get(segment.fieldNumber)?.id) ?? '';
    };
    return { byId, byNumber, place, reader };
  }
}

function targetKindOf(host: NumberHostKind): 'process_type' | 'project_type' | 'node_kind' {
  if (host === 'node') return 'node_kind';
  if (host === 'project') return 'project_type';
  return 'process_type';
}

function sourceValues(
  target: NumberTarget,
  segment: NumberFieldSegment,
): Readonly<Record<string, unknown>> | null {
  switch (segment.source) {
    case 'self':
      return target.sources.self;
    case 'project':
      return target.sources.project ?? null;
    case 'parent_task':
      return target.sources.parentTask ?? null;
    case 'folder': {
      const folder = target.sources.folders?.find((entry) => entry.kindId === segment.nodeKindId);
      return folder?.values ?? null;
    }
    case 'company':
      return null;
  }
}

function valueOf(
  values: Readonly<Record<string, unknown>> | null | undefined,
  fieldId: string | undefined,
): string | null {
  if (!values || !fieldId) return null;
  const value = values[fieldId];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function momentNow(): NumberMoment {
  const now = new Date();
  return { year: companyYear(now), month: companyMonth(now), day: companyDay(now) };
}

function segmentInfo(context: PlanContext, segment: NumberFieldSegment): EmptySegmentInfo {
  return {
    fieldNumber: segment.fieldNumber,
    source: segment.source,
    name: context.byNumber.get(segment.fieldNumber)?.name ?? '—',
  };
}
