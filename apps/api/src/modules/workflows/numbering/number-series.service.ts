import { Injectable } from '@nestjs/common';
import { ErrorCode, normalizeTypeConfig, numberPeriodSchema } from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { companyYear } from '../../../core/time/company-time.js';
import { numberScopeKey, parseNumberTemplate, renderNumberTemplate } from './number-template.js';

/** Выданный номер: серия, группа счёта, год, порядковый номер и печатная строка. */
export interface AssignedNumber {
  seriesId: string;
  /** Ключ группы «разрез × период» (аудит выдачи; PK строки счётчика). */
  scopeKey: string;
  year: number;
  seq: number;
  /** «Вх-2026/118» — то, что видит человек и журнал перехода. */
  display: string;
  assignedAt: Date;
}

/**
 * Серии номеров «Процессов» (#55 → #630, Р3): номер выдаётся в транзакции
 * действия (переход с `assign_number`), поэтому откат действия не сдвигает
 * счётчик — номеров без пропусков. Серия несёт правило «разрез × период ×
 * шаблон × старт»; группа счёта — строка `(series_id, scope_key)`, upsert
 * с `last_value + 1` сериализует параллельные выдачи серии (30/день —
 * норма, очередь на строке незаметна). Год/месяц — по поясу компании
 * (`COMPANY_TIMEZONE`): письмо, зарегистрированное 1 января в 02:30 по
 * Минску, получает новый год.
 *
 * Единственный писатель `number_counters` — этот сервис (единая точка
 * сериализации гонок). Вычисление разреза записи (заготовки/формула,
 * `NUMBER_SCOPE_*`) — Пакет 2 #630; письмо-серии считаются общим счётом.
 */
@Injectable()
export class NumberSeriesService {
  /**
   * Следующий номер типа процесса: серия берётся из `config.numbering`.
   * Нет серии у типа — 409 `WORKFLOW_NUMBERING_NOT_CONFIGURED` (маршрут с
   * `assign_number` без нумерации — ошибка конфигурации, а не письма).
   */
  async nextForType(
    tx: TransactionClient,
    typeId: string,
    at = new Date(),
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
    const series = await tx.numberSeries.findUnique({
      where: { id: seriesId },
      select: { period: true },
    });
    if (!series) {
      throw new DomainException(
        ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED,
        'Number series not found',
        { seriesId },
      );
    }
    // Письмо-серии — общий разрез (scope_kind='none'): группа = только
    // период-часть ключа. Разрезы записи приедут с Пакетом 2 #630.
    // Домен period гарантирован CHECK миграции — parse только сужает тип.
    const period = numberPeriodSchema.parse(series.period);
    return this.next(tx, seriesId, numberScopeKey(period, at, null), at);
  }

  /**
   * Следующий номер серии в группе `scopeKey` (вычислен вызывающим по
   * правилу серии и записи). Первый номер группы — `startValue` серии
   * (продолжение нумерации из Excel); откат транзакции не сдвигает счётчик.
   */
  async next(
    tx: TransactionClient,
    seriesId: string,
    scopeKey: string,
    at = new Date(),
  ): Promise<AssignedNumber> {
    const series = await tx.numberSeries.findUnique({
      where: { id: seriesId },
      select: { id: true, template: true, startValue: true },
    });
    if (!series) {
      throw new DomainException(
        ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED,
        'Number series not found',
        { seriesId },
      );
    }
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
    const year = companyYear(at);
    const rows = await tx.$queryRaw<{ last_value: number }[]>(Prisma.sql`
      INSERT INTO "number_counters" ("series_id", "scope_key", "year", "last_value")
      VALUES (${seriesId}::uuid, ${scopeKey}, ${year}, ${series.startValue})
      ON CONFLICT ("series_id", "scope_key")
        DO UPDATE SET "last_value" = "number_counters"."last_value" + 1
      RETURNING "last_value"
    `);
    const seq = rows[0]!.last_value;
    return {
      seriesId: series.id,
      scopeKey,
      year,
      seq,
      display: renderNumberTemplate(template.segments, { seq, at }),
      assignedAt: at,
    };
  }
}
