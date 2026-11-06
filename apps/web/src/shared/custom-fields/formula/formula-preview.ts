import type {
  CustomFieldDefinition,
  CustomFieldValue,
  FormulaValidationIssue,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { ApiError } from '../../api-client.js';
import {
  formatDuration,
  formatIsoDate,
  formatIsoDateTime,
  formatMoney,
  formatNumber,
} from '../value-format.js';

/** Тексты редактора формул: проблема проверки, превью значения, отказ
 *  сохранения. Коды — из contracts, тексты — i18n `ui.formulas`. */

export function issueText(issue: FormulaValidationIssue): string {
  const known = ui.formulas.shapeIssues[issue.code as keyof typeof ui.formulas.shapeIssues];
  return known ?? issue.message;
}

export function previewText(
  value: CustomFieldValue | null,
  definition: CustomFieldDefinition,
): string {
  if (value === null || value === undefined) return ui.formulas.editor.resultEmpty;
  if (typeof value === 'number') {
    return definition.type === 'duration'
      ? formatDuration(value)
      : formatNumber(value, definition.settings.precision ?? 0);
  }
  if (typeof value === 'boolean') {
    return value ? ui.customFields.value.yes : ui.formulas.editor.resultEmpty;
  }
  if (typeof value === 'string') {
    // Пример в редакторе — тот же очиститель, что в карточке: пустой операнд
    // не должен показывать `--`/`—`/`−` даже до пересчёта движком.
    const cleaned = cleanFormulaText(value);
    if (typeof cleaned !== 'string') return ui.formulas.editor.resultEmpty;
    if (definition.type === 'date') return formatIsoDate(cleaned);
    if (definition.type === 'datetime') return formatIsoDateTime(cleaned);
    return cleaned;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : ui.formulas.editor.resultEmpty;
  }
  return formatMoney(value, null);
}

export function saveErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const known = ui.formulas.saveErrors[error.code as keyof typeof ui.formulas.saveErrors];
    if (known) return known;
  }
  return ui.formulas.editor.saveError;
}

/** Значение целиком из дефисов — это старый «пустой» маркер, а не текст. */
const EMPTY_DASH_VALUE = /^[\s—–−-]+$/;
/** Висячие разделители по краям: пустой операнд склейки оставлял `--`/`—`. */
const EDGE_DASHES = /[\s—–−-]+$/;

/**
 * Формульное значение без пустых маркеров и ВИСЯЧИХ разделителей (Р13).
 * Нормализация на отображении нужна и для уже материализованных значений:
 * они пересчитываются не на каждом чтении.
 *
 * Чистим только края и только разделители: легитимные дефисы внутри текста
 * (`ГОСТ 12—3`, `A--B`) и знак числа (`-5`) не трогаем — иначе отображение
 * портит данные пользователя.
 */
export function cleanFormulaText(
  value: CustomFieldValue | null | undefined,
): CustomFieldValue | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  if (EMPTY_DASH_VALUE.test(value)) return null;
  let cleaned = value.replace(EDGE_DASHES, '');
  // `--5` — знак числа, а не разделитель.
  cleaned = cleaned.replace(/^-{2,}(?=\d)/, '-');
  if (!/^-\d/.test(cleaned)) cleaned = cleaned.replace(/^[\s—–−-]+/, '');
  // Наследие пустого операнда в середине: `2026--42` → `2026-42`.
  cleaned = cleaned.replace(/(?<=\d)-{2,}(?=\d)/g, '-');
  return cleaned === '' ? null : cleaned;
}
