import { z } from 'zod';

import {
  numberCountKey,
  numberPeriodKey,
  numberTemplateSegmentSchema,
  renderNumberTemplate as renderSegments,
  type NumberPeriod,
  type NumberTemplateSegment,
} from '@nodus/contracts';

import { companyMonth, companyYear } from '../../../core/time/company-time.js';

/**
 * Шаблон номера и ключ счёта (#630): чистые функции без БД поверх
 * контрактной грамматики (одна для сервера, веба и моков). Пояс — компании:
 * письмо, выданное 1 января в 02:30 по Минску, получает новый год.
 */

/** Читатель поля-сегмента шаблона: значение атрибута записи (`self`) или её
 *  проекта (`project`). Нет читателя или атрибут удалён/пуст — пустая
 *  вставка: выдача номера не падает. */
export type NumberFieldReader = (
  segment: Extract<NumberTemplateSegment, { kind: 'field' }>,
) => string;

export interface NumberRenderInput {
  seq: number;
  at: Date;
  field?: NumberFieldReader;
}

/** Парс JSONB-шаблона серии: ровно один `counter` — иначе правило не может
 *  выдать номер (409 в сервисе). */
export function parseNumberTemplate(
  raw: unknown,
): { ok: true; segments: NumberTemplateSegment[] } | { ok: false } {
  const parsed = z.array(numberTemplateSegmentSchema).min(1).safeParse(raw);
  if (!parsed.success) return { ok: false };
  if (parsed.data.filter((s) => s.kind === 'counter').length !== 1) return { ok: false };
  return { ok: true, segments: parsed.data };
}

/** Момент выдачи частями по поясу компании. */
export function companyMoment(at: Date): { year: number; month: number } {
  return { year: companyYear(at), month: companyMonth(at) };
}

/** Рендер номера в поясе компании: «Вх-2026/118», «15-26», «Изм. 3». */
export function renderNumberTemplate(
  segments: readonly NumberTemplateSegment[],
  input: NumberRenderInput,
): string {
  return renderSegments(segments, {
    seq: input.seq,
    ...companyMoment(input.at),
    field: input.field,
  });
}

/** Счёт момента: период-часть и ключ строки `number_counters`. Формат
 *  ключа — PRIMARY KEY живых строк прода (письма — «2026»), менять нельзя. */
export function numberCountOf(
  period: NumberPeriod,
  at: Date,
  containerId: string | null,
): { periodKey: string; scopeKey: string } {
  const periodKey = numberPeriodKey(period, companyMoment(at));
  return { periodKey, scopeKey: numberCountKey(containerId, periodKey) };
}

/** Шаблон письмо-серии из префикса — бит-в-бит формату #55
 *  `${prefix}-${year}/${seq}`; им же backfill миграции и посев ensureSeries. */
export function letterSeriesTemplate(prefix: string): NumberTemplateSegment[] {
  return [
    { kind: 'literal', text: prefix },
    { kind: 'literal', text: '-' },
    { kind: 'year', digits: 4 },
    { kind: 'literal', text: '/' },
    { kind: 'counter' },
  ];
}
