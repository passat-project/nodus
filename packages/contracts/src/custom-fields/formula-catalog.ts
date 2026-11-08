import type { CustomFieldType } from './custom-field.schemas.js';
import type {
  FormulaAggregateFn,
  FormulaEntity,
  FormulaFunctionId,
  FormulaHostKind,
  FormulaSelector,
  FormulaSource,
  FormulaValueType,
} from './formula.js';

/**
 * Каталог языка формул (#632, Р2): функции с сигнатурами, агрегаты, матрица
 * «носитель → источники», совместимость типов и лимиты. Данные без логики —
 * их читают редактор (палитры), сервер (валидация) и движок (тайпинг).
 */

/** Спецификация функции каталога: аргументы, результат, группа палитры. */
export interface FormulaFunctionSpec {
  id: FormulaFunctionId;
  /** Типы аргументов по порядку; последний повторяется при `variadic`. */
  args: FormulaValueType[];
  variadic?: boolean;
  /** 'arg2' — результат совпадает с типом второго аргумента (ЕСЛИ). */
  result: FormulaValueType | 'arg2';
  minArgs: number;
  maxArgs: number;
  group: 'logic' | 'math' | 'text' | 'date';
}

/** Каталог функций V1 (16): имена — русская локализация Excel (i18n). */
export const FORMULA_FUNCTIONS: readonly FormulaFunctionSpec[] = [
  {
    id: 'if',
    args: ['boolean', 'string', 'string'],
    result: 'arg2',
    minArgs: 3,
    maxArgs: 3,
    group: 'logic',
  },
  {
    id: 'and',
    args: ['boolean', 'boolean'],
    variadic: true,
    result: 'boolean',
    minArgs: 2,
    maxArgs: 10,
    group: 'logic',
  },
  {
    id: 'or',
    args: ['boolean', 'boolean'],
    variadic: true,
    result: 'boolean',
    minArgs: 2,
    maxArgs: 10,
    group: 'logic',
  },
  { id: 'not', args: ['boolean'], result: 'boolean', minArgs: 1, maxArgs: 1, group: 'logic' },
  {
    id: 'round',
    args: ['number', 'number'],
    result: 'number',
    minArgs: 1,
    maxArgs: 2,
    group: 'math',
  },
  {
    id: 'roundup',
    args: ['number', 'number'],
    result: 'number',
    minArgs: 1,
    maxArgs: 2,
    group: 'math',
  },
  {
    id: 'rounddown',
    args: ['number', 'number'],
    result: 'number',
    minArgs: 1,
    maxArgs: 2,
    group: 'math',
  },
  { id: 'abs', args: ['number'], result: 'number', minArgs: 1, maxArgs: 1, group: 'math' },
  {
    id: 'left',
    args: ['string', 'number'],
    result: 'string',
    minArgs: 1,
    maxArgs: 2,
    group: 'text',
  },
  {
    id: 'right',
    args: ['string', 'number'],
    result: 'string',
    minArgs: 1,
    maxArgs: 2,
    group: 'text',
  },
  { id: 'len', args: ['string'], result: 'number', minArgs: 1, maxArgs: 1, group: 'text' },
  {
    id: 'text',
    args: ['number', 'string'],
    result: 'string',
    minArgs: 2,
    maxArgs: 2,
    group: 'text',
  },
  { id: 'year', args: ['date'], result: 'number', minArgs: 1, maxArgs: 1, group: 'date' },
  { id: 'month', args: ['date'], result: 'number', minArgs: 1, maxArgs: 1, group: 'date' },
  { id: 'day', args: ['date'], result: 'number', minArgs: 1, maxArgs: 1, group: 'date' },
  {
    id: 'datedif',
    args: ['date', 'date', 'string'],
    result: 'number',
    minArgs: 3,
    maxArgs: 3,
    group: 'date',
  },
];

export const FORMULA_FUNCTION_BY_ID: ReadonlyMap<FormulaFunctionId, FormulaFunctionSpec> = new Map(
  FORMULA_FUNCTIONS.map((spec) => [spec.id, spec]),
);

/** Источники, дающие ОДНО значение (допустимы в узле `field`). Цепочка папок
 *  и связанные записи многозначны — только внутри агрегата. */
export const FORMULA_SINGLE_VALUE_SOURCES: readonly FormulaSource['kind'][] = [
  'self',
  'parent_task',
  'folder_nearest',
  'project',
  'company',
  'ref_field',
];

/** Агрегаты: нужен ли атрибут выборки, нужен ли фильтр и какой тип даёт
 *  результат. «Все/хотя бы одна» — про условие выборки (filter), а не про
 *  значение атрибута. */
export interface FormulaAggregateSpec {
  id: FormulaAggregateFn;
  field: 'required' | 'forbidden';
  filter: 'required' | 'optional';
  /** 'field' — тип атрибута выборки (последняя/мин/макс). */
  result: FormulaValueType | 'field';
}

export const FORMULA_AGGREGATES: readonly FormulaAggregateSpec[] = [
  { id: 'every', field: 'forbidden', filter: 'required', result: 'boolean' },
  { id: 'some', field: 'forbidden', filter: 'required', result: 'boolean' },
  { id: 'count', field: 'forbidden', filter: 'optional', result: 'number' },
  { id: 'last', field: 'required', filter: 'optional', result: 'field' },
  { id: 'sum', field: 'required', filter: 'optional', result: 'number' },
  { id: 'unique', field: 'required', filter: 'optional', result: 'list' },
  { id: 'min', field: 'required', filter: 'optional', result: 'field' },
  { id: 'max', field: 'required', filter: 'optional', result: 'field' },
  { id: 'avg', field: 'required', filter: 'optional', result: 'number' },
];

export const FORMULA_AGGREGATE_BY_ID: ReadonlyMap<FormulaAggregateFn, FormulaAggregateSpec> =
  new Map(FORMULA_AGGREGATES.map((spec) => [spec.id, spec]));

/** Атрибут какого типа принимает результат какого типа формулы. Текстовое
 *  поле принимает любой тип с автопревращением в строку (как «&» в Excel);
 *  число и продолжительность — number; деньги — money; ссылки — ref
 *  (конкретный вид цели проверяется динамически); списки — list. */
export const FORMULA_FIELD_TYPE_COMPAT: Readonly<
  Record<CustomFieldType, readonly FormulaValueType[]>
> = {
  text: ['number', 'string', 'boolean', 'date', 'datetime', 'money', 'ref', 'list'],
  long_text: ['number', 'string', 'boolean', 'date', 'datetime', 'money', 'ref', 'list'],
  link: ['string'],
  number: ['number'],
  money: ['money'],
  date: ['date'],
  datetime: ['datetime'],
  duration: ['number'],
  bool: ['boolean'],
  enum: ['string'],
  multienum: ['list'],
  users: ['list'],
  user: ['ref'],
  department: ['ref'],
  project: ['ref'],
  counterparty: ['ref'],
  task: ['ref'],
  letter: ['ref'],
  node: ['ref'],
  /** Счётчик (#630, Р10): формулой не заполняется — номер пишет только
   *  движок; чужие формулы читать значение могут (строка). */
  counter: [],
};

/** Матрица «носитель → допустимые источники» (Р7): пункт палитры редактора
 *  неактивен, сервер отвечает 422 `FORMULA_SOURCE_FORBIDDEN`. */
export const FORMULA_SOURCE_MATRIX: Readonly<
  Record<FormulaHostKind, readonly FormulaSource['kind'][]>
> = {
  task: [
    'self',
    'parent_task',
    'folder_nearest',
    'folder_chain',
    'project',
    'company',
    'ref_field',
    'related',
  ],
  node: ['self', 'folder_nearest', 'folder_chain', 'project', 'company', 'ref_field', 'related'],
  project: ['self', 'company', 'ref_field'],
  letter: ['self', 'company', 'ref_field'],
};

/** Матрица «носитель → допустимые селекторы связанных записей». */
export const FORMULA_RELATED_MATRIX: Readonly<
  Record<FormulaHostKind, readonly FormulaSelector['kind'][]>
> = {
  task: ['subtasks', 'relations', 'node_tasks'],
  node: ['node_tasks'],
  project: [],
  letter: [],
};

/** Вложенная формула типа/вида (вычисляется на чтении, Р6): источники
 *  `related` и `folder_chain` запрещены — стоимость на каждую строку списка. */
export const FORMULA_TYPE_FORBIDDEN_SOURCES: readonly FormulaSource['kind'][] = [
  'related',
  'folder_chain',
];

/** Лимиты языка (Р2): глубина, размер, источники, литерал-строка. Значения
 *  повторяют CUSTOM_FIELD_LIMITS — источник истины там. */
export const FORMULA_LIMITS = {
  depth: 12,
  nodes: 60,
  sources: 8,
  literalText: 500,
  selection: 500,
  cascadeDepth: 8,
} as const;

/** Системные поля, доступные формулам (#632): адресуются `entity:key` и
 *  читаются у записи-источника (self, родитель, папка, проект, ссылка).
 *  Список закрыт и расширяется вместе с DTO сущностей. */
export interface FormulaSystemFieldSpec {
  entity: FormulaEntity;
  key: string;
  type: FormulaValueType;
}

export const FORMULA_SYSTEM_FIELDS: readonly FormulaSystemFieldSpec[] = [
  { entity: 'task', key: 'title', type: 'string' },
  { entity: 'task', key: 'number', type: 'number' },
  { entity: 'task', key: 'deadline', type: 'datetime' },
  { entity: 'task', key: 'createdAt', type: 'datetime' },
  { entity: 'task', key: 'stage', type: 'string' },
  { entity: 'task', key: 'assignee', type: 'ref' },
  { entity: 'task', key: 'creator', type: 'ref' },
  { entity: 'letter', key: 'subject', type: 'string' },
  { entity: 'letter', key: 'regNumber', type: 'string' },
  { entity: 'letter', key: 'regDate', type: 'date' },
  { entity: 'letter', key: 'receivedAt', type: 'datetime' },
  { entity: 'letter', key: 'correspondent', type: 'ref' },
  { entity: 'letter', key: 'theirNumber', type: 'string' },
  { entity: 'letter', key: 'theirDate', type: 'date' },
  { entity: 'project', key: 'name', type: 'string' },
  { entity: 'project', key: 'status', type: 'string' },
  { entity: 'project', key: 'startDate', type: 'date' },
  { entity: 'project', key: 'endDate', type: 'date' },
  { entity: 'project', key: 'manager', type: 'ref' },
  { entity: 'node', key: 'name', type: 'string' },
  { entity: 'node', key: 'kind', type: 'string' },
  { entity: 'node', key: 'createdAt', type: 'datetime' },
];

export const FORMULA_SYSTEM_FIELD_BY_KEY: ReadonlyMap<string, FormulaSystemFieldSpec> = new Map(
  FORMULA_SYSTEM_FIELDS.map((field) => [`${field.entity}:${field.key}`, field]),
);
