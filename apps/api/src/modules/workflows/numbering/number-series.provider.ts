import { Injectable } from '@nestjs/common';
import {
  numberContainerHitSchema,
  numberContainerSchema,
  numberPeriodSchema,
  type NumberContainerHit,
  type NumberHostKind,
  type NumberSeriesRule,
} from '@nodus/contracts';
import { z } from 'zod';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { NumberSeriesService } from '../numbering/number-series.service.js';
import { numberCountOf, parseNumberTemplate } from '../numbering/number-template.js';
import type {
  IssueNumberInput,
  NumberAssignmentRow,
  NumberCounterRow,
  NumberSeriesData,
  NumberSeriesStore,
} from '../ports/number-series.port.js';

const hitsSchema = z.array(numberContainerHitSchema);

/**
 * Реализация порта серий (#630): чтения — своими запросами, выдача и
 * «следующий номер» — `NumberSeriesService` (единственный писатель счетов и
 * журнала). JSONB-шаблон разбирается контрактной грамматикой; битая серия
 * не выдаёт номер (null), а не падает на каждом создании записи.
 */
@Injectable()
export class NumberSeriesStoreProvider implements NumberSeriesStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumberSeriesService,
  ) {}

  async byId(tx: TransactionClient, id: string): Promise<NumberSeriesData | null> {
    const [data] = await this.byIds(tx, [id]);
    return data ?? null;
  }

  async byIds(tx: TransactionClient, ids: readonly string[]): Promise<NumberSeriesData[]> {
    if (ids.length === 0) return [];
    const rows = await tx.numberSeries.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: {
        id: true,
        name: true,
        containers: true,
        period: true,
        template: true,
        startValue: true,
        step: true,
      },
    });
    return rows.flatMap((row) => {
      const parsed = parseNumberTemplate(row.template);
      if (!parsed.ok) return [];
      const containers = z.array(numberContainerSchema).safeParse(row.containers);
      return [
        {
          id: row.id,
          name: row.name,
          containers: containers.success ? containers.data : [],
          period: numberPeriodSchema.parse(row.period),
          template: parsed.segments,
          startValue: row.startValue,
          step: row.step,
        },
      ];
    });
  }

  async create(
    tx: TransactionClient,
    data: { code: string; name: string; rule: NumberSeriesRule },
  ): Promise<string> {
    const row = await tx.numberSeries.create({
      data: {
        code: data.code,
        // Легаси-поля письмо-серий (#55): у счётчика атрибута префикс не
        // участвует в шаблоне, `reset` — зеркало периода для старых читателей.
        prefix: '',
        reset: data.rule.period === 'none' ? 'year' : data.rule.period,
        name: data.name,
        containers: data.rule.containers as unknown as Prisma.InputJsonValue,
        period: data.rule.period,
        template: data.rule.template as unknown as Prisma.InputJsonValue,
        startValue: data.rule.startValue,
        step: data.rule.step,
      },
      select: { id: true },
    });
    return row.id;
  }

  async update(
    tx: TransactionClient,
    id: string,
    data: { name?: string; rule: NumberSeriesRule },
  ): Promise<void> {
    await tx.numberSeries.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        containers: data.rule.containers as unknown as Prisma.InputJsonValue,
        period: data.rule.period,
        template: data.rule.template as unknown as Prisma.InputJsonValue,
        startValue: data.rule.startValue,
        step: data.rule.step,
        reset: data.rule.period === 'none' ? 'year' : data.rule.period,
      },
    });
  }

  next(tx: TransactionClient, id: string, input: IssueNumberInput) {
    return this.numbers.next(tx, id, input);
  }

  setNext(
    tx: TransactionClient,
    id: string,
    input: { hits: readonly NumberContainerHit[]; nextValue: number; at?: Date },
  ) {
    return this.numbers.setNext(tx, id, input);
  }

  async issuedCounts(tx: TransactionClient, ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.numberAssignment.groupBy({
      by: ['seriesId'],
      where: { seriesId: { in: [...new Set(ids)] } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.seriesId, row._count._all]));
  }

  async counters(tx: TransactionClient, seriesId: string): Promise<NumberCounterRow[]> {
    const rows = await tx.numberCounter.findMany({
      where: { seriesId },
      orderBy: [{ updatedAt: 'desc' }, { scopeKey: 'asc' }],
      select: {
        scopeKey: true,
        periodKey: true,
        containerRefs: true,
        lastValue: true,
        year: true,
      },
    });
    return rows.map((row) => ({
      scopeKey: row.scopeKey,
      periodKey: row.periodKey,
      hits: hitsOf(row.containerRefs),
      lastValue: row.lastValue,
      year: row.year,
    }));
  }

  async counter(
    tx: TransactionClient,
    seriesId: string,
    hits: readonly NumberContainerHit[],
    at: Date = new Date(),
  ): Promise<NumberCounterRow | null> {
    const series = await this.byId(tx, seriesId);
    if (!series) return null;
    const { scopeKey } = numberCountOf(series.period, at, hits);
    const row = await tx.numberCounter.findUnique({
      where: { seriesId_scopeKey: { seriesId, scopeKey } },
      select: {
        scopeKey: true,
        periodKey: true,
        containerRefs: true,
        lastValue: true,
        year: true,
      },
    });
    if (!row) return null;
    return {
      scopeKey: row.scopeKey,
      periodKey: row.periodKey,
      hits: hitsOf(row.containerRefs),
      lastValue: row.lastValue,
      year: row.year,
    };
  }

  async assignments(
    tx: TransactionClient,
    hostKind: NumberHostKind,
    hostId: string,
  ): Promise<NumberAssignmentRow[]> {
    const rows = await tx.numberAssignment.findMany({
      where: { hostKind, hostId },
      orderBy: [{ assignedAt: 'asc' }, { seq: 'asc' }],
      select: {
        seriesId: true,
        scopeKey: true,
        containerRefs: true,
        periodKey: true,
        seq: true,
        display: true,
        hostKind: true,
        hostId: true,
        fieldId: true,
        actorId: true,
        source: true,
        sourceLabel: true,
        assignedAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      hits: hitsOf(row.containerRefs),
      source: row.source as NumberAssignmentRow['source'],
      hostKind: row.hostKind as NumberAssignmentRow['hostKind'],
    }));
  }

  async hasAssignment(
    tx: TransactionClient,
    seriesId: string,
    hostKind: NumberHostKind,
    hostId: string,
    fieldId: string | null,
  ): Promise<boolean> {
    return (
      (await tx.numberAssignment.count({
        where: { seriesId, hostKind, hostId, fieldId },
      })) > 0
    );
  }
}

/** JSONB-значения условий: мусор в колонке не должен ронять окно счетов. */
function hitsOf(raw: unknown): NumberContainerHit[] {
  const parsed = hitsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}
