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
    if (definition.type === 'date') return formatIsoDate(value);
    if (definition.type === 'datetime') return formatIsoDateTime(value);
    return value;
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
