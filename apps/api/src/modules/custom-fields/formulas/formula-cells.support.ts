import { ErrorCode } from '@nodus/contracts';
import type { FormulaCellError, FormulaHostKind } from '@nodus/contracts';
import type { FormulaValidationIssue } from '@nodus/formula-engine';

import type { FormulaCellRef } from '../ports/formula-cells.port.js';
import type { FormulaCellRow } from './formula-cells.repository.js';

/** Вспомогательное для сервиса ячеек (#632): коды отказа и формы строк. */

/** Код отказа API по блокирующей проблеме формулы (каталог Р13). */
export function errorCodeOf(issue: FormulaValidationIssue): ErrorCode {
  switch (issue.code) {
    case 'type_mismatch':
      return ErrorCode.FORMULA_TYPE_MISMATCH;
    case 'source_forbidden':
    case 'selector_forbidden':
      return ErrorCode.FORMULA_SOURCE_FORBIDDEN;
    case 'depth':
    case 'nodes':
    case 'sources':
    case 'literal_text':
      return ErrorCode.FORMULA_LIMIT_EXCEEDED;
    default:
      return ErrorCode.FORMULA_AST_INVALID;
  }
}

export function refOf(row: FormulaCellRow): FormulaCellRef {
  return {
    cellId: row.id,
    hostKind: row.hostKind as FormulaHostKind,
    hostId: row.hostId,
    fieldId: row.fieldId,
  };
}

/** Ошибка ячейки из JSONB (терпимо к старым формам). */
export function asCellError(raw: unknown): FormulaCellError {
  const value = raw as Partial<FormulaCellError> | null;
  return {
    code: (value?.code ?? 'eval_failed') as FormulaCellError['code'],
    message: value?.message ?? 'formula evaluation failed',
    ...(typeof value?.number === 'number' ? { number: value.number } : {}),
  };
}
