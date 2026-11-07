import { z } from 'zod';

import {
  numberTemplateSegmentSchema,
  renderNumberTemplate as renderSegments,
  type NumberPeriod,
  type NumberTemplateSegment,
} from '@nodus/contracts';

import { companyMonth, companyYear } from '../../../core/time/company-time.js';

/**
 * Шаблон номера и ключ группы счёта (#630, Р2/Р3): чистые функции без БД —
 * рендер сегментов (грамматика рендера — в contracts, одна для сервера,
 * веба и моков) и нормализация ключа группы «разрез × период». Письмо-
 * формат «Вх-2026/118» и годовой переход 31.12→01.01 проверяются юнитами
 * без моков (фиксированный момент).
 */

/** Читатель поля-сегмента шаблона: значение атрибута записи (`self`) или её
 *  проекта (`project`). Нет читателя (письмо-путь Пакета 0) или атрибут
 *  удалён/пуст — пустая вставка: выдача номера не падает (Р2). */
export type NumberFieldReader = (
  segment: Extract<NumberTemplateSegment, { kind: 'field' }>,
) => string;

export interface NumberRenderInput {
  seq: number;
  at: Date;
  field?: NumberFieldReader;
}

/** Парс JSONB-шаблона серии: сегменты обязаны содержать ровно один
 *  `counter` — иначе правило не может выдать номер (409 в сервисе). */
export function parseNumberTemplate(
  raw: unknown,
): { ok: true; segments: NumberTemplateSegment[] } | { ok: false } {
  const parsed = z.array(numberTemplateSegmentSchema).min(1).safeParse(raw);
  if (!parsed.success) return { ok: false };
  if (parsed.data.filter((s) => s.kind === 'counter').length !== 1) return { ok: false };
  return { ok: true, segments: parsed.data };
}

/** Рендер номера в поясе компании: «Вх-2026/118», «15-26», «Изм. 3». */
export function renderNumberTemplate(
  segments: readonly NumberTemplateSegment[],
  input: NumberRenderInput,
): string {
  return renderSegments(segments, {
    seq: input.seq,
    year: companyYear(input.at),
    month: companyMonth(input.at),
    field: input.field,
  });
}

/** Период-часть ключа группы: границы — пояс компании (год/месяц момента). */
function periodPart(period: NumberPeriod, at: Date): string | null {
  switch (period) {
    case 'year':
      return String(companyYear(at));
    case 'month':
      return `${companyYear(at)}-${String(companyMonth(at)).padStart(2, '0')}`;
    case 'none':
      return null;
  }
}

/** Ключ группы счёта: нормализованная строка «разрез|период» (пустые части
 *  не пишутся; без частей — 'common'). Стабилен при переименовании цели
 *  разреза (uuid/значение, не имя). Единственный читатель — upsert счётчика,
 *  формат менять нельзя: он же PRIMARY KEY живых строк. */
export function numberScopeKey(period: NumberPeriod, at: Date, scopePart: string | null): string {
  const parts = [scopePart, periodPart(period, at)].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join('|') : 'common';
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
