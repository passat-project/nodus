import type {
  ConditionPredicate,
  ConditionQuantifier,
  ConditionRecordRef,
  CustomFieldDefinition,
  CustomFieldValue,
  MoneyValue,
  TransitionBlockReason,
} from '@nodus/contracts';
import {
  CONDITION_LIMITS,
  customFieldIdOfKey,
  isCustomFieldValueFilled,
  readCustomFieldValue,
  sameCustomFieldValue,
} from '@nodus/contracts';

/**
 * Чистая логика общей выборки (#635, unified-model §7): предикаты по записи,
 * кванторы по полному составу и сбор причины. Без I/O — источники множеств и
 * видимость подтягивает сервис (evaluator.service.ts), здесь только правила.
 * Один вход вычисления: условия шагов (#634), правила (#448), показатели
 * папки (#865) и фильтр списков (#435) зовут ЭТУ логику, своего языка не
 * заводят.
 */

/** Стадия маршрута в индексе предикатов этапа/итога/«результат выдан». */
export interface ConditionStageInfo {
  systemState: string;
  outcome: string | null;
  resultIssued: boolean;
}

/** Индекс стадий по типу записи: stage_is/system_state/outcome/result_issued.
 *  Внутренний Map итерируется в порядке маршрута (sortOrder) — на этом
 *  держится «результат выдан» (отметка действует «с этого статуса и дальше»). */
export interface ConditionStageIndex {
  /** typeId → стадия по stageId (живые стадии маршрута типа). */
  stages: ReadonlyMap<string, ReadonlyMap<string, ConditionStageInfo>>;
}

/** Определения атрибутов по id — предикаты `field` (#635). */
export type ConditionFieldDefs = ReadonlyMap<
  string,
  Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>
>;

/** Запись выборки в терминах логики (порт отдаёт полную форму). */
export interface ConditionRow {
  kind: ConditionRecordRef['entityKind'];
  id: string;
  name: string;
  typeId: string | null;
  stageId: string | null;
  values: Readonly<Record<string, unknown>>;
}

/** Полная выборка → предикаты → квантор. `violators` — записи, которыми
 *  выборка ложна (для `all` — непрошедшие; `any` — все, если никого нет;
 *  `none` — прошедшие). Дженерик сохраняет исходный тип записей (порт
 *  отдаёт полную форму — она же идёт в фильтр видимости причин). */
export function evaluateSelection<T extends ConditionRow>(
  rows: readonly T[],
  where: readonly ConditionPredicate[],
  quantifier: ConditionQuantifier,
  index: ConditionStageIndex,
  defs: ConditionFieldDefs,
): { passed: boolean; violators: T[] } {
  const passes = rows.map((row) => where.every((p) => predicatePasses(row, p, index, defs)));
  const some = passes.some(Boolean);
  switch (quantifier) {
    case 'all':
      return { passed: passes.every(Boolean), violators: rows.filter((_, i) => !passes[i]) };
    case 'any':
      return { passed: some, violators: some ? [] : [...rows] };
    case 'none':
      return { passed: !some, violators: rows.filter((_, i) => passes[i]) };
  }
}

/** Предикат по одной записи (#635). Публикация гарантирует совместимость
 *  ссылок и операторов; время исполнения считает по живым данным. */
export function predicatePasses(
  row: ConditionRow,
  predicate: ConditionPredicate,
  index: ConditionStageIndex,
  defs: ConditionFieldDefs,
): boolean {
  switch (predicate.kind) {
    case 'type_is':
      return row.typeId === predicate.typeId;
    case 'field':
      return fieldPredicate(row, predicate, defs);
    case 'stage_is':
      return row.stageId === predicate.stageId;
    case 'system_state':
      return stageOf(row, index)?.systemState === predicate.state;
    case 'outcome':
      return stageOf(row, index)?.outcome === predicate.outcome;
    case 'result_issued':
      return resultIssued(row, index);
  }
}

function stageOf(row: ConditionRow, index: ConditionStageIndex): ConditionStageInfo | undefined {
  if (row.typeId === null || row.stageId === null) return undefined;
  return index.stages.get(row.typeId)?.get(row.stageId);
}

/** «Результат выдан» (#635, §11): отметка статуса действует «с этого статуса
 *  и дальше» («Выдано в печать» и все статусы после него — выдано, хотя
 *  работа ещё не закрыта); в маршруте нет ни одной отметки — выдана =
 *  закрыта успешно. Дальше = позже по порядку маршрута (sortOrder). */
function resultIssued(row: ConditionRow, index: ConditionStageIndex): boolean {
  const stages = row.typeId === null ? undefined : index.stages.get(row.typeId);
  if (!stages || row.stageId === null) return false;
  if (![...stages.values()].some((stage) => stage.resultIssued)) {
    const stage = stages.get(row.stageId);
    return stage?.systemState === 'closed' && stage?.outcome === 'success';
  }
  let issued = false;
  for (const [stageId, stage] of stages) {
    if (stage.resultIssued) issued = true;
    if (stageId === row.stageId) return issued;
  }
  return false;
}

function fieldPredicate(
  row: ConditionRow,
  predicate: Extract<ConditionPredicate, { kind: 'field' }>,
  defs: ConditionFieldDefs,
): boolean {
  const fieldId = customFieldIdOfKey(predicate.field);
  if (fieldId === null) return false;
  const raw = row.values[fieldId];
  const filled = isCustomFieldValueFilled(raw);
  switch (predicate.op) {
    case 'filled':
      return filled;
    case 'not_filled':
      return !filled;
  }
  const definition = defs.get(fieldId);
  if (!definition) return false;
  // Толерантное чтение (Р3): несовместимое хранимое — «не задано».
  const value = readCustomFieldValue(definition, raw);
  const expected = predicate.value ?? null;
  switch (predicate.op) {
    case 'eq':
      return expected === null
        ? !filled
        : value !== undefined && sameCustomFieldValue(value, expected);
    case 'ne':
      return expected === null
        ? filled
        : value === undefined || !sameCustomFieldValue(value, expected);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return orderPredicate(value, expected, predicate.op);
    case 'contains':
      return containsPredicate(value, expected, false);
    case 'not_contains':
      return containsPredicate(value, expected, true);
    case 'in_any':
      return inAnyPredicate(value, expected);
  }
}

/** Сравнение чисел/дат/денег: деньги — по сумме той же валюты, даты и счётчики
 *  — лексикографически (ISO 8601 упорядочен), иначе — несравнимо (ложь). */
function orderPredicate(
  value: CustomFieldValue | undefined,
  expected: CustomFieldValue | null,
  op: 'gt' | 'gte' | 'lt' | 'lte',
): boolean {
  const cmp = compareValues(value, expected);
  if (cmp === null) return false;
  switch (op) {
    case 'gt':
      return cmp > 0;
    case 'gte':
      return cmp >= 0;
    case 'lt':
      return cmp < 0;
    case 'lte':
      return cmp <= 0;
  }
}

function compareValues(
  value: CustomFieldValue | undefined,
  expected: CustomFieldValue | null,
): number | null {
  if (value === undefined || expected === null) return null;
  if (typeof value === 'number' && typeof expected === 'number') return value - expected;
  if (typeof value === 'string' && typeof expected === 'string') {
    return value < expected ? -1 : value > expected ? 1 : 0;
  }
  if (isMoney(value) && isMoney(expected)) {
    if (value.currencyId !== expected.currencyId) return null;
    return value.amount - expected.amount;
  }
  return null;
}

function isMoney(value: unknown): value is MoneyValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as MoneyValue).amount === 'number' &&
    typeof (value as MoneyValue).currencyId === 'string'
  );
}

/** «Содержит» — подстрока (без учёта регистра) в текстовом значении. */
function containsPredicate(
  value: CustomFieldValue | undefined,
  expected: CustomFieldValue | null,
  negate: boolean,
): boolean {
  const contains =
    typeof value === 'string' &&
    typeof expected === 'string' &&
    value.toLowerCase().includes(expected.toLowerCase());
  return negate ? !contains : contains;
}

/** «Один из» — пересечение (скаляр читается как массив, Р3). */
function inAnyPredicate(
  value: CustomFieldValue | undefined,
  expected: CustomFieldValue | null,
): boolean {
  if (!Array.isArray(expected) || expected.length === 0) return false;
  if (value === undefined) return false;
  const items = Array.isArray(value) ? value : [value];
  const allowed = new Set(expected.filter((item): item is string => typeof item === 'string'));
  return items.some((item) => typeof item === 'string' && allowed.has(item));
}

/** Причина проверки по записям (#635): подпись настройщика + до 5 записей,
 *  видимых актору, + счётчик невидимых («и ещё N без доступа» — видимость
 *  одна). Нарушители сверх 5 видимых не считаются скрытыми — их счёт
 *  показывает «и ещё N записей» интерфейсом списка. */
export function recordsReason(
  title: string,
  violators: readonly ConditionRow[],
  visibleIds: ReadonlySet<string>,
): TransitionBlockReason {
  const visible = violators.filter((row) => visibleIds.has(row.id));
  const shown = visible
    .slice(0, CONDITION_LIMITS.reasonRecords)
    .map((row): ConditionRecordRef => ({ id: row.id, entityKind: row.kind, name: row.name }));
  return {
    kind: 'records',
    title,
    records: shown,
    hiddenCount: violators.length - visible.length,
  };
}
