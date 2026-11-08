import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  normalizeTypeConfig,
  numberPeriodSchema,
  type NumberHostKind,
} from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { companyYear } from '../../../core/time/company-time.js';
import { numberCountOf, parseNumberTemplate, renderNumberTemplate } from './number-template.js';

/** Выданный номер: серия, счёт (контейнер × период), порядковый номер и печатная строка. */
export interface AssignedNumber {
  seriesId: string;
  /** Ключ счёта (PK строки `number_counters`). */
  scopeKey: string;
  /** Контейнер счёта: id папки/проекта/портфеля/задачи/значения; null — вся компания. */
  containerId: string | null;
  periodKey: string;
  year: number;
  seq: number;
  /** «Вх-2026/118» — то, что видит человек и журнал перехода. */
  display: string;
  assignedAt: Date;
}

/** Кому выдан номер — строка журнала `number_assignments`. */
export interface NumberHost {
  kind: NumberHostKind;
  id: string;
  /** Атрибут-цель (null у письмо-серий). */
  fieldId: string | null;
  actorId: string | null;
}

export interface NextNumberInput {
  /** Контейнер счёта, найденный вызывающим (`resolveNumberContainer`); null — вся компания. */
  containerId: string | null;
  at?: Date;
  /** Журнал выдачи: без host строка журнала не пишется (только тесты низкого уровня). */
  host?: NumberHost;
}

interface SeriesRow {
  id: string;
  period: string;
  template: unknown;
  startValue: number;
}

/**
 * Серии номеров (#55 → #630): номер выдаётся в транзакции действия
 * (переход с `assign_number`), поэтому откат действия не сдвигает счётчик —
 * без пропусков и дублей. Счёт — строка `(series_id, scope_key)` = контейнер
 * × период; upsert `last_value + 1` сериализует параллельные выдачи. Первый
 * номер нового счёта — `start_value` серии; продолжение конкретного счёта
 * из Excel — `setNext` (только вперёд).
 *
 * Единственный писатель `number_counters` и `number_assignments`. Поиск
 * контейнера записи (порты модулей + `resolveNumberContainer`) — у
 * вызывающего: сервис получает готовый `containerId`.
 */
@Injectable()
export class NumberSeriesService {
  /**
   * Следующий номер типа процесса (письма): серия из `config.numbering`,
   * контейнер — вся компания. Нет серии — 409 `WORKFLOW_NUMBERING_NOT_CONFIGURED`.
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
    return this.next(tx, seriesId, { containerId: null, at, host });
  }

  /**
   * Следующий номер серии в счёте контейнера. Первый номер нового счёта —
   * `startValue` серии (или «следующий номер», заданный `setNext`); откат
   * транзакции не сдвигает счётчик.
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
    const { periodKey, scopeKey } = numberCountOf(this.period(series), at, input.containerId);
    const year = companyYear(at);
    const rows = await tx.$queryRaw<{ last_value: number }[]>(Prisma.sql`
      INSERT INTO "number_counters"
        ("series_id", "scope_key", "year", "last_value", "container_id", "period_key")
      VALUES (${seriesId}::uuid, ${scopeKey}, ${year}, ${series.startValue},
              ${input.containerId}::uuid, ${periodKey})
      ON CONFLICT ("series_id", "scope_key")
        DO UPDATE SET "last_value" = "number_counters"."last_value" + 1, "updated_at" = now()
      RETURNING "last_value"
    `);
    const seq = rows[0]!.last_value;
    const display = renderNumberTemplate(template.segments, { seq, at });
    if (input.host) {
      await tx.numberAssignment.create({
        data: {
          seriesId,
          scopeKey,
          containerId: input.containerId,
          periodKey,
          seq,
          display,
          hostKind: input.host.kind,
          hostId: input.host.id,
          fieldId: input.host.fieldId,
          actorId: input.host.actorId,
          assignedAt: at,
        },
      });
    }
    return {
      seriesId,
      scopeKey,
      containerId: input.containerId,
      periodKey,
      year,
      seq,
      display,
      assignedAt: at,
    };
  }

  /**
   * «Следующий номер» счёта текущего периода — только вперёд (продолжение
   * из Excel/с бумаги). Счёта ещё нет — создаётся с `last_value = next - 1`.
   * Меньше уже выданного — 409 `NUMBER_NEXT_BACKWARDS` (номера не
   * переиспользуются); равный текущему следующему — без изменений.
   */
  async setNext(
    tx: TransactionClient,
    seriesId: string,
    input: { containerId: string | null; nextValue: number; at?: Date },
  ): Promise<{ lastValue: number }> {
    const at = input.at ?? new Date();
    const series = await this.series(tx, seriesId);
    const { periodKey, scopeKey } = numberCountOf(this.period(series), at, input.containerId);
    const target = input.nextValue - 1;
    const rows = await tx.$queryRaw<{ last_value: number }[]>(Prisma.sql`
      INSERT INTO "number_counters"
        ("series_id", "scope_key", "year", "last_value", "container_id", "period_key")
      VALUES (${seriesId}::uuid, ${scopeKey}, ${companyYear(at)}, ${target},
              ${input.containerId}::uuid, ${periodKey})
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
      select: { id: true, period: true, template: true, startValue: true },
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
