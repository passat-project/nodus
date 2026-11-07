import type {
  CustomFieldDefinition,
  CustomFieldFormulas,
  CustomFieldValue,
  CustomFieldValues,
  FormulaHostKind,
  FormulaNode,
  FormulaValidationIssue,
} from '@nodus/contracts';
import { customFieldValueSchemaOf, ErrorCode, sameCustomFieldValue } from '@nodus/contracts';
import { evaluate, validateFormula } from '@nodus/formula-engine';
import { HttpResponse } from 'msw';
import type { FormulaValue } from '@nodus/formula-engine';

import { demoCustomFieldDefinitions, demoFieldById } from '../../mocks/data/custom-fields.js';
import { demoDictionaryItems } from '../../mocks/data/dictionaries.js';
import { findDemoNodeRow } from '../../mocks/data/project-nodes.js';
import { findLetter } from '../../mocks/data/letters.js';
import { findDemoProjectRow } from '../../mocks/data/projects.js';

import { demoResolver } from './formula-resolver.js';
import {
  demoFormulaMeta,
  dropFormulaCell,
  findDemoTask,
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

/** Формулы места (#632, Р6): формула живёт на привязке «атрибут × место»
 *  (`field_bindings.default_formula`), поэтому у одного атрибута в разных
 *  типах/видах разные формулы. */
export function typeFormulaSlots(
  _kind: FormulaHostKind,
  placeId: string | null | undefined,
): FormulaSlot[] {
  if (!placeId) return [];
  return demoCustomFieldDefinitions.flatMap((definition) => {
    const formula = definition.bindingFormulas?.[placeId];
    return formula ? [{ fieldId: definition.id, formula }] : [];
  });
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
 *  формула типа (формульная ячейка руками не пишется, #660). */
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

/** id места записи (тип процесса/проекта, вид папки) для формулы типа. */
function placeIdOf(kind: FormulaHostKind, hostId: string): string | null {
  switch (kind) {
    case 'task':
      return findDemoTask(hostId)?.type.id ?? null;
    case 'letter':
      return findLetter(hostId)?.typeId ?? null;
    case 'node':
      return findDemoNodeRow(hostId)?.kindId ?? null;
    case 'project':
      return findDemoProjectRow(hostId)?.typeId ?? null;
  }
}

/** Эффективная формула ячейки для редактора (GET): своя, иначе формула
 *  типа/вида как основа для правки; `origin` объясняет, откуда она. */
export function effectiveFormula(
  kind: FormulaHostKind,
  hostId: string,
  fieldId: string,
): { ast: FormulaNode | null; origin: 'own' | 'type' | null } {
  const own = readOwnFormula(kind, hostId, fieldId);
  if (own) return { ast: own, origin: 'own' };
  const host = findFormulaHost(kind, hostId);
  if (!host) return { ast: null, origin: null };
  const slot = typeFormulaSlots(kind, placeIdOf(kind, hostId)).find(
    (entry) => entry.fieldId === fieldId,
  );
  if (!slot) return { ast: null, origin: null };
  return { ast: slot.formula, origin: 'type' };
}

/** Своя формула ячейки (GET): null — формулы нет. */
export function readOwnFormula(
  kind: FormulaHostKind,
  hostId: string,
  fieldId: string,
): FormulaNode | null {
  return readFormulaCell(kind, hostId, fieldId)?.ast ?? null;
}

/** Снять свою формулу (DELETE): вычисленное значение очищается (#660). */
export function removeOwnFormula(kind: FormulaHostKind, hostId: string, fieldId: string): boolean {
  // Вычисленное формулой значение очищается вместе с формулой (#660):
  // ячейка пуста или под формулой типа/вида, «снимка» больше нет.
  dropHostValue(kind, hostId, fieldId);
  return dropFormulaCell(kind, hostId, fieldId);
}

/** Готовый 422-ответ формульной блокировки для мок-хендлеров значений
 *  (#660): null — блокировки нет, значение пишется. Паритет сервера:
 *  проверяются только реальные изменения (включая null-очистку). */
export function lockedPatchResponse(
  kind: FormulaHostKind,
  hostId: string,
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Response | null {
  const error = mockLockedFieldError(kind, hostId, changedValueKeys(current, patch));
  return error ? HttpResponse.json(error, { status: 422 }) : null;
}

/** Реально изменённые ключи патча значений (включая null-очистку) —
 *  паритет серверного prepareUpdate: только «настоящие» изменения попадают
 *  под проверку формульной блокировки (#660). */
export function changedValueKeys(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): string[] {
  const base = current ?? {};
  return Object.keys(patch).filter(
    (fieldId) => !sameCustomFieldValue(base[fieldId], patch[fieldId]),
  );
}

/** Убрать ключ значения у демо-хоста (снятие формулы очищает значение). */
function dropHostValue(kind: FormulaHostKind, hostId: string, fieldId: string): void {
  const host = findFormulaHost(kind, hostId);
  if (!host) return;
  const next = { ...host.customFields };
  delete next[fieldId];
  setHostValues(kind, hostId, next);
}

/** Тело 422-ответа формульной блокировки для мок-хендлеров значений (#660):
 *  null — блокировки нет, значение пишется. Паритет FORMULA_CELL_LOCKED. */
export function mockLockedFieldError(
  kind: FormulaHostKind,
  hostId: string,
  source: Record<string, unknown> | readonly string[],
): { code: string; message: string; details: { fields: string[] } } | null {
  const values = source as Record<string, unknown>;
  const fieldIds = Array.isArray(source)
    ? source
    : Object.keys(values).filter((fieldId) => values[fieldId] !== null);
  const locked = lockedMockFieldIds(kind, hostId, fieldIds);
  if (locked.size === 0) return null;
  return {
    code: 'FORMULA_CELL_LOCKED',
    message: 'Formula cell value is computed by its formula',
    details: { fields: [...locked] },
  };
}

/** Формульно-заблокированные ключи (паритет сервера, #660): у атрибута
 *  своя формула или формула слота места — значение пишет только формула. */
export function lockedMockFieldIds(
  kind: FormulaHostKind,
  hostId: string,
  fieldIds: readonly string[],
): Set<string> {
  const result = new Set<string>();
  if (fieldIds.length === 0) return result;
  const own = ownCellsOf(kind, hostId);
  const placeId = placeIdOf(kind, hostId);
  const slots = placeId ? typeFormulaSlots(kind, placeId) : [];
  for (const fieldId of fieldIds) {
    if (own.has(fieldId) || slots.some((slot) => slot.fieldId === fieldId)) {
      result.add(fieldId);
    }
  }
  return result;
}
