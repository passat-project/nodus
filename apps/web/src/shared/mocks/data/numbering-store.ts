import { renderNumberTemplate, type NumberSeriesRule } from '@nodus/contracts';

import { demoCustomFieldDefinitions } from './custom-fields.js';
import { fieldIds } from './field-ids.js';

/**
 * Мок-выдача номеров счётчиков (#630): счётчики в памяти, ключ — атрибут +
 * группа (разрез × период, как `numberScopeKey` сервера). Инкремент от
 * `startValue` правила, рендер — общий контрактный `renderNumberTemplate`
 * (одна грамматика с сервером, I12). Состояние живёт до перезагрузки
 * страницы — моки не претендуют на хранение.
 */
const counters = new Map<string, number>();
/** Выдано номеров атрибуту всеми группами (сводка диалога). */
const issuedTotals = new Map<string, number>();

/** Части момента по Минску — как `COMPANY_TIMEZONE` сервера. */
function minskParts(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value ?? 0),
    month: Number(parts.find((p) => p.type === 'month')?.value ?? 0),
  };
}

/** Правило counter-атрибута из мок-магазина (null — атрибут не счётчик). */
export function counterRuleOf(fieldId: string): NumberSeriesRule | null {
  const definition = demoCustomFieldDefinitions.find((entry) => entry.id === fieldId);
  return definition?.type === 'counter' ? (definition.numbering?.rule ?? null) : null;
}

/** Выдать номер: seq растёт в группе от startValue; повторная выдача тому
 *  же полю той же записи — конфликт (К5), его ловит хендлер перехода. */
export function issueMockNumber(
  fieldId: string,
  rule: NumberSeriesRule,
  scopePart: string | null,
  now: Date = new Date(),
): string {
  const { year, month } = minskParts(now);
  const periodPart =
    rule.period === 'year'
      ? String(year)
      : rule.period === 'month'
        ? `${year}-${String(month).padStart(2, '0')}`
        : null;
  const key = [fieldId, scopePart, periodPart].filter(Boolean).join('|') || `${fieldId}|common`;
  const seq = (counters.get(key) ?? rule.startValue - 1) + 1;
  counters.set(key, seq);
  issuedTotals.set(fieldId, (issuedTotals.get(fieldId) ?? 0) + 1);
  return renderNumberTemplate(rule.template, { seq, year, month, field: () => '…' });
}

/** Сколько номеров выдано атрибуту (сводка «Выдано номеров» в диалоге). */
export function mockIssuedCount(fieldId: string): number {
  return issuedTotals.get(fieldId) ?? 0;
}

export { fieldIds };
