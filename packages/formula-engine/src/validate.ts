import {
  checkFormulaShape,
  FORMULA_FIELD_TYPE_COMPAT,
  type CustomFieldType,
  type FormulaHostKind,
  type FormulaNode,
  type FormulaShapeIssue,
} from '@nodus/contracts';

import { inferType } from './infer-type.js';
import type {
  FormulaRegistryMeta,
  FormulaValidationIssue,
  FormulaValidationResult,
} from './types.js';

/**
 * Полная проверка формулы перед сохранением: форма (лимиты, матрица
 * источников, арность) + типы + совместимость с типом атрибута-ячейки.
 * `typeDefault` — формула типа/вида (запрещены related/цепочка папок, Р6).
 */
function fromShape(issue: FormulaShapeIssue): FormulaValidationIssue {
  return { code: issue.code, path: issue.path, message: issue.message, blocking: true };
}

export function validateFormula(
  ast: FormulaNode,
  opts: {
    hostKind: FormulaHostKind;
    meta: FormulaRegistryMeta;
    /** Тип атрибута-ячейки: результат обязан к нему подходить. */
    targetFieldType?: CustomFieldType;
    typeDefault?: boolean;
  },
): FormulaValidationResult {
  const shape = checkFormulaShape(ast, opts.hostKind, { typeDefault: opts.typeDefault });
  if (shape.some((entry) => entry.code === 'ast_invalid')) {
    return { ok: false, issues: shape.map(fromShape), type: null };
  }
  const inferred = inferType(ast, opts.meta);
  const issues: FormulaValidationIssue[] = [
    ...shape.map(fromShape),
    ...inferred.issues.map((entry) => ({
      code: entry.code,
      path: entry.path,
      message: entry.message,
      ...(entry.number === undefined ? {} : { number: entry.number }),
      blocking: entry.code === 'type_mismatch',
    })),
  ];
  if (opts.targetFieldType && inferred.type !== null) {
    const allowed = FORMULA_FIELD_TYPE_COMPAT[opts.targetFieldType];
    if (!allowed.includes(inferred.type)) {
      issues.push({
        code: 'type_mismatch',
        path: '',
        message: `result ${inferred.type} does not fit ${opts.targetFieldType}`,
        blocking: true,
      });
    }
  }
  return { ok: issues.every((entry) => !entry.blocking), issues, type: inferred.type };
}
