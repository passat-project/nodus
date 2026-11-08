import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  normalizeTypeConfig,
  numberPeriodSchema,
  type NumberContainerHit,
  type NumberHostKind,
  type NumberIssueSource,
} from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { companyYear } from '../../../core/time/company-time.js';
import { numberCountOf, parseNumberTemplate, renderNumberTemplate } from './number-template.js';

/** Выданный номер: серия, счёт (значения условий × период), порядковый номер и печатная строка. */
export interface AssignedNumber {
  seriesId: string;
  /** Ключ счёта (PK строки `number_counters`). */
  scopeKey: string;
  /** Значения условий счёта в порядке правила; [] — сквозная. */
  hits: NumberContainerHit[];
  periodKey: string;
  year: number;
  seq: number;
  /** «Вх-2026/118» — то, что видит человек и журнал перехода. */
  display: string;
  assignedAt: Date;
}

/** Кому и как выдан номер — строка журнала `number_assignments`. */
export interface NumberHost {
  kind: NumberHostKind;
  id: string;
  /** Атрибут-цель (null у письмо-серий). */
  fieldId: string | null;
  actorId: string | null;
  /** Способ выдачи: при создании, кнопкой, выдача существующим… */
  source: NumberIssueSource;
  /** Название кнопки на момент выдачи (у `transition`). */
  sourceLabel?: string | null;
}

export interface NextNumberInput {
  /** Значения условий, найденные вызывающим (`resolveNumberContainers`); [] — сквозная. */
  hits: readonly NumberContainerHit[];
  at?: Date;
  /** Журнал выдачи: без host строка журнала не пишется (только тесты низкого уровня). */
  host?: NumberHost;
}

interface SeriesRow {
  id: string;
  period: string;
  template: unknown;
  startValue: number;
  step: number;
}

/**
 * Серии номеров (#55 → #630, модель v3): номер выдаётся в транзакции
 * действия (создание, переход с `assign_number`, выдача существующим),
 * поэтому откат действия не сдвигает счётчик — без пропусков и дублей. Счёт
 * — строка `(series_id, scope_key)` = значения условий × период; upsert
 * `last_value + step` сериализует параллельные выдачи. Первый номер нового
 * счёта — `start_value` серии; продолжение конкретного счёта из Excel —
 * `setNext` (только вперёд).
 *
 * Единственный писатель `number_counters` и `number_assignments`. Поиск
 * значений условий записи (порты модулей + `resolveNumberContainers`) — у
 * вызывающего: сервис получает готовые `hits`. Порядок блокировок при
 * нескольких номерах одного действия — по id серии (вызывающий сортирует).
 */
@Injectable()
export class NumberSeriesService {
  /**
   * Следующий номер типа процесса (письма): серия из `config.numbering`,
   * сквозная. Нет серии — 409 `WORKFLOW_NUMBERING_NOT_CONFIGURED`.
   */
  async nextForType(
    tx: TransactionClient,
    typeId: string,
    at = new Date(),
    host?: NumberHost,
  ): Promise<AssignedNumber> {
    const type = await tx.processType.findUnique({
      where: { id: typeId },
      select: { config: true },
    });
    const seriesId = normalizeTypeConfig(type?.config).numbering?.seriesId;
    if (!seriesId) {
      throw new DomainException(
        ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED,
        'Process type has no number series',
        { typeId },
      );
    }
    return this.next(tx, seriesId, { hits: [], at, host });
  }

  /**
   * Следующий номер серии в счёте значений условий. Первый номер нового
   * счёта — `startValue` серии (или «следующий номер», заданный `setNext`);
   * откат транзакции не сдвигает счётчик.
   */
  async next(
    tx: TransactionClient,
    seriesId: string,
    input: NextNumberInput,
  ): Promise<AssignedNumber> {
    const at = input.at ?? new Date();
    const series = await this.series(tx, seriesId);
    const template = parseNumberTemplate(series.template);
    if (!template.ok) {
      // Правило пишется только валидным путём; битый JSONB — сломанная
      // конфигурация серии, а не «номер без шаблона».
      throw new DomainException(
        ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED,
        'Number series template is invalid',
        { seriesId },
      );
    }
    const hits = [...input.hits];
    const { periodKey, scopeKey } = numberCountOf(this.period(series), at, hits);
    const year = companyYear(at);
    const refs = JSON.stringify(hits);
    const rows = await tx.$queryRaw<{ last_value: number }[]>(Prisma.sql`
      INSERT INTO "number_counters"
        ("series_id", "scope_key", "year", "last_value", "container_refs", "period_key")
      VALUES (${seriesId}::uuid, ${scopeKey}, ${year}, ${series.startValue},
              ${refs}::jsonb, ${periodKey})
      ON CONFLICT ("series_id", "scope_key")
        DO UPDATE SET "last_value" = "number_counters"."last_value" + ${series.step},
                      "updated_at" = now()
      RETURNING "last_value"
    `);
    const seq = rows[0]!.last_value;
    const display = renderNumberTemplate(template.segments, { seq, at });
    if (input.host) {
      await tx.numberAssignment.create({
        data: {
          seriesId,
          scopeKey,
          containerRefs: hits as unknown as Prisma.InputJsonValue,
          periodKey,
          seq,
          display,
          hostKind: input.host.kind,
          hostId: input.host.id,
          fieldId: input.host.fieldId,
          actorId: input.host.actorId,
          source: input.host.source,
          sourceLabel: input.host.sourceLabel ?? null,
          assignedAt: at,
        },
      });
    }
    return { seriesId, scopeKey, hits, periodKey, year, seq, display, assignedAt: at };
  }

  /**
   * «Следующий номер» счёта текущего периода — только вперёд (продолжение
   * из Excel/с бумаги). Счёта ещё нет — создаётся с `last_value = next − step`.
   * Меньше уже выданного — 409 `NUMBER_NEXT_BACKWARDS` (номера не
   * переиспользуются); равный текущему следующему — без изменений.
   */
  async setNext(
    tx: TransactionClient,
    seriesId: string,
    input: { hits: readonly NumberContainerHit[]; nextValue: number; at?: Date },
  ): Promise<{ lastValue: number }> {
    const at = input.at ?? new Date();
    const series = await this.series(tx, seriesId);
    const hits = [...input.hits];
    const { periodKey, scopeKey } = numberCountOf(this.period(series), at, hits);
    const target = input.nextValue - series.step;
    const rows = await tx.$queryRaw<{ last_value: number }[]>(Prisma.sql`
      INSERT INTO "number_counters"
        ("series_id", "scope_key", "year", "last_value", "container_refs", "period_key")
      VALUES (${seriesId}::uuid, ${scopeKey}, ${companyYear(at)}, ${target},
              ${JSON.stringify(hits)}::jsonb, ${periodKey})
      ON CONFLICT ("series_id", "scope_key")
        DO UPDATE SET "last_value" = EXCLUDED."last_value", "updated_at" = now()
        WHERE "number_counters"."last_value" <= EXCLUDED."last_value"
      RETURNING "last_value"
    `);
    if (rows.length === 0) {
      const current = await tx.numberCounter.findUnique({
        where: { seriesId_scopeKey: { seriesId, scopeKey } },
        select: { lastValue: true },
      });
      throw new DomainException(
        ErrorCode.NUMBER_NEXT_BACKWARDS,
        'Next number is below the already issued one',
        { seriesId, lastValue: current?.lastValue ?? null, nextValue: input.nextValue },
      );
    }
    return { lastValue: rows[0]!.last_value };
  }

  /** Сколько номеров выдано серией (журнал выдач). */
  async issuedCount(tx: TransactionClient, seriesId: string): Promise<number> {
    return tx.numberAssignment.count({ where: { seriesId } });
  }

  private async series(tx: TransactionClient, seriesId: string): Promise<SeriesRow> {
    const series = await tx.numberSeries.findUnique({
      where: { id: seriesId },
      select: { id: true, period: true, template: true, startValue: true, step: true },
    });
    if (!series) {
      throw new DomainException(
        ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED,
        'Number series not found',
        { seriesId },
      );
    }
    return series;
  }

  /** Домен period гарантирован CHECK миграции — parse только сужает тип. */
  private period(series: SeriesRow) {
    return numberPeriodSchema.parse(series.period);
  }
}
