import type {
  CustomFieldDefinition,
  CustomFieldFormulas,
  CustomFieldValue,
  CustomFieldValues,
  FormulaHostKind,
  FormulaNode,
  FormulaValidationIssue,
} from '@nodus/contracts';
import { ErrorCode, customFieldIdOfKey, customFieldValueSchemaOf } from '@nodus/contracts';
import { evaluate, validateFormula } from '@nodus/formula-engine';
import type { FormulaValue } from '@nodus/formula-engine';

import { demoFieldById } from '../../mocks/data/custom-fields.js';
import { demoDictionaryItems } from '../../mocks/data/dictionaries.js';
import { demoNodeKinds } from '../../mocks/data/project-nodes.js';
import { demoProjectTypes } from '../../mocks/data/projects.js';
import { creationFormOf, mockTypes } from '../../mocks/data/process-types-store.js';

import { demoResolver } from './formula-resolver.js';
import {
  demoFormulaMeta,
  dropFormulaCell,
  findFormulaHost,
  ownCellsOf,
  readFormulaCell,
  setHostValues,
  writeFormulaCell,
} from './formula-state.js';

/** Применение формул в мок-мире (#632):
 *  - формула типа/вида (слот формы места) считается НА ЧТЕНИИ (Р6) для
 *    записей без своего значения и своей формулы;
 *  - своя формула ячейки живёт в состоянии (`formula-state.ts`) и
 *    материализует значение в `customFields` хоста при сохранении;
 *  - ошибка ячейки не блокирует работу: значение пустое, в DTO — бейдж. */

/** Формула слота формы места (тип процесса, тип проекта, вид папки). */
export interface FormulaSlot {
  fieldId: string;
  formula: FormulaNode;
}

/** Слоты-формулы места: `placeId` — тип процесса/проекта или вид папки. */
export function typeFormulaSlots(
  kind: FormulaHostKind,
  placeId: string | null | undefined,
): FormulaSlot[] {
  if (!placeId) return [];
  switch (kind) {
    case 'task':
    case 'letter': {
      const type = mockTypes.find((entry) => entry.id === placeId);
      if (!type) return [];
      return creationFormOf(type).fields.flatMap((slot) => {
        const fieldId = customFieldIdOfKey(slot.key);
        return fieldId !== null && slot.formula ? [{ fieldId, formula: slot.formula }] : [];
      });
    }
    case 'node': {
      const nodeKind = demoNodeKinds.find((entry) => entry.id === placeId);
      return (nodeKind?.form.fields ?? []).flatMap((slot) =>
        slot.formula ? [{ fieldId: slot.fieldId, formula: slot.formula }] : [],
      );
    }
    case 'project': {
      const projectType = demoProjectTypes.find((entry) => entry.id === placeId);
      return (projectType?.form.fields ?? []).flatMap((slot) =>
        slot.formula ? [{ fieldId: slot.fieldId, formula: slot.formula }] : [],
      );
    }
  }
}

/** Вариант справочника по ПОДПИСИ (формула отдаёт подпись, хранится id). */
function dictionaryItemId(definition: CustomFieldDefinition, label: string): string | null {
  const dictionaryId = definition.settings.dictionaryId;
  if (!dictionaryId) return null;
  const items = demoDictionaryItems.filter((item) => item.dictionaryId === dictionaryId);
  const match =
    items.find((item) => item.name === label) ?? items.find((item) => item.code === label);
  return match?.id ?? null;
}

/** Значение формулы → значение атрибута (грамматика типа): списки получают
 *  id вариантов обратно, несовместимое значение не материализуется. */
function materializeValue(
  definition: CustomFieldDefinition | undefined,
  value: FormulaValue,
): CustomFieldValue | null {
  if (definition === undefined || value === null) return null;
  if (definition.type === 'enum') return dictionaryItemId(definition, String(value));
  if (definition.type === 'multienum') {
    const labels = Array.isArray(value) ? value : [String(value)];
    return labels
      .map((label) => dictionaryItemId(definition, label))
      .filter((id): id is string => id !== null);
  }
  return customFieldValueSchemaOf(definition).safeParse(value).success
    ? (value as CustomFieldValue)
    : null;
}

/** Запись места: значения и id места (тип/вид) для поиска формул слота. */
export interface FormulaPlaceRecord {
  id: string;
  customFields: CustomFieldValues;
}

export interface ComputedFieldValues {
  customFields: CustomFieldValues;
  customFieldFormulas: CustomFieldFormulas;
}

/** Формулы типа/вида поверх значений записи (DTO сущности, не мутируя
 *  хранимые данные: вызывающий клонирует DTO). Приоритет: своя формула →
 *  вписанное значение → формула типа. */
export function applyTypeFormulas(
  kind: FormulaHostKind,
  record: FormulaPlaceRecord,
  slots: readonly FormulaSlot[],
): ComputedFieldValues {
  const values: CustomFieldValues = { ...record.customFields };
  const formulas: CustomFieldFormulas = {};
  // Своя формула ячейки важнее формулы типа: значение уже материализовано.
  for (const [fieldId, cell] of ownCellsOf(kind, record.id)) {
    formulas[fieldId] = { origin: 'own', ...(cell.error ? { error: cell.error } : {}) };
    if (cell.value !== null) values[fieldId] = cell.value;
  }
  // Нет формул слота (тип без формулы) — резолвер не нужен: списки задач
  // считаются на каждую строку, лишняя сборка мира не нужна.
  if (slots.length === 0) return { customFields: values, customFieldFormulas: formulas };
  const resolver = demoResolver(kind, record.id);
  if (!resolver) return { customFields: values, customFieldFormulas: formulas };
  for (const slot of slots) {
    if (formulas[slot.fieldId] !== undefined) continue;
    // Вписанное руками значение подавляет формулу типа (кнопка «Как у типа»).
    if (record.customFields[slot.fieldId] !== undefined) {
      formulas[slot.fieldId] = { origin: 'value' };
      continue;
    }
    const evaluation = evaluate(slot.formula, resolver);
    if (evaluation.error) {
      formulas[slot.fieldId] = { origin: 'type', error: evaluation.error };
      continue;
    }
    formulas[slot.fieldId] = { origin: 'type' };
    const materialized = materializeValue(demoFieldById(slot.fieldId), evaluation.value);
    if (materialized !== null) values[slot.fieldId] = materialized;
  }
  return { customFields: values, customFieldFormulas: formulas };
}

/** Код отказа API по блокирующей проблеме формулы (каталог #632, Р2). */
export function formulaErrorCode(code: FormulaValidationIssue['code']): ErrorCode {
  switch (code) {
    case 'ast_invalid':
    case 'arity':
    case 'aggregate_field':
    case 'type_default_forbidden':
      return ErrorCode.FORMULA_AST_INVALID;
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
      // attribute_deleted/attribute_unavailable не блокируют сохранение.
      return ErrorCode.FORMULA_AST_INVALID;
  }
}

/** Итог сохранения своей формулы: ok либо 422 с кодом и проблемами. */
export interface FormulaSaveResult {
  ok: boolean;
  code?: ErrorCode;
  issues?: FormulaValidationIssue[];
}

/** PUT формулы ячейки: проверка (тип атрибута-цели) → вычисление →
 *  материализация значения в `customFields` хоста. Ошибка ячейки
 *  сохранение не блокирует (Р13). */
export function saveOwnFormula(
  kind: FormulaHostKind,
  hostId: string,
  fieldId: string,
  ast: FormulaNode,
): FormulaSaveResult {
  const definition = demoFieldById(fieldId);
  const resolver = demoResolver(kind, hostId);
  if (!definition || !resolver) return { ok: false };
  const validation = validateFormula(ast, {
    hostKind: kind,
    meta: demoFormulaMeta(),
    targetFieldType: definition.type,
  });
  const blocking = validation.issues.filter((issue) => issue.blocking);
  const first = blocking[0];
  if (first) return { ok: false, code: formulaErrorCode(first.code), issues: blocking };
  const evaluation = evaluate(ast, resolver);
  const materialized = evaluation.error ? null : materializeValue(definition, evaluation.value);
  const values: CustomFieldValues = { ...(findFormulaHost(kind, hostId)?.customFields ?? {}) };
  if (materialized === null) delete values[fieldId];
  else values[fieldId] = materialized;
  setHostValues(kind, hostId, values);
  writeFormulaCell(kind, hostId, fieldId, {
    ast,
    error: evaluation.error,
    value: materialized,
  });
  return { ok: true };
}

/** Своя формула ячейки (GET): null — формулы нет. */
export function readOwnFormula(
  kind: FormulaHostKind,
  hostId: string,
  fieldId: string,
): FormulaNode | null {
  return readFormulaCell(kind, hostId, fieldId)?.ast ?? null;
}

/** Снять свою формулу (DELETE): последнее значение остаётся снимком (Р5). */
export function removeOwnFormula(kind: FormulaHostKind, hostId: string, fieldId: string): boolean {
  return dropFormulaCell(kind, hostId, fieldId);
}
