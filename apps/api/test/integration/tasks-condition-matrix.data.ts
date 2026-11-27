import type { ConditionFieldOp, CustomFieldType } from '@nodus/contracts';

/**
 * Таблица матрицы «оператор × тип атрибута» общей выборки #635 (данные
 * интеграционного набора tasks-condition-matrix). Ожидания записаны явно
 * для каждой клетки: вариант значения хоста × оператор — кнопка видна
 * (условие истинно) или спрятана. Грани: ключа нет, null в JSONB,
 * массивы и пересечение in_any, деньги с чужой валютой, contains —
 * подстрока и регистр, eq/ne null («пусто»).
 */

export interface MatrixCase {
  op: ConditionFieldOp;
  value?: unknown;
  expect: Record<string, boolean>;
}

export interface MatrixType {
  type: CustomFieldType;
  /** Варианты значений хостов: ключ → значение; `undefined` — ключа нет. */
  variants: Record<string, unknown | undefined>;
  ops: MatrixCase[];
}

const ITEM_A = 'b0000000-0000-4000-8000-00000000000a';
const ITEM_B = 'b0000000-0000-4000-8000-00000000000b';
const ITEM_C = 'b0000000-0000-4000-8000-00000000000c';
const ITEM_D = 'b0000000-0000-4000-8000-00000000000d';
const CUR_1 = 'c0000000-0000-4000-8000-000000000001';
export { CUR_1 };
const CUR_2 = 'c0000000-0000-4000-8000-000000000002';
const DEP_1 = 'd0000000-0000-4000-8000-000000000001';
const DEP_2 = 'd0000000-0000-4000-8000-000000000002';
const PROJ_1 = 'e0000000-0000-4000-8000-000000000001';
const PROJ_2 = 'e0000000-0000-4000-8000-000000000002';
const TASK_1 = 'f0000000-0000-4000-8000-000000000001';
const TASK_2 = 'f0000000-0000-4000-8000-000000000002';
const LETTER_1 = 'f0000000-0000-4000-8000-000000000003';
const LETTER_2 = 'f0000000-0000-4000-8000-000000000004';
const NODE_1 = 'f0000000-0000-4000-8000-000000000005';
const NODE_2 = 'f0000000-0000-4000-8000-000000000006';
const CP_1 = 'a0000000-0000-4000-8000-000000000001';
const CP_2 = 'a0000000-0000-4000-8000-000000000002';

/** Порядковые операции (number-семантика) на вариантах low/at/high + пусто. */
const ORDER_OPS = (at: unknown): MatrixCase[] => [
  { op: 'eq', value: at, expect: { low: false, at: true, high: false, absent: false } },
  { op: 'ne', value: at, expect: { low: true, at: false, high: true, absent: true } },
  { op: 'eq', value: null, expect: { low: false, at: false, high: false, absent: true } },
  { op: 'ne', value: null, expect: { low: true, at: true, high: true, absent: false } },
  { op: 'gt', value: at, expect: { low: false, at: false, high: true, absent: false } },
  { op: 'gte', value: at, expect: { low: false, at: true, high: true, absent: false } },
  { op: 'lt', value: at, expect: { low: true, at: false, high: false, absent: false } },
  { op: 'lte', value: at, expect: { low: true, at: true, high: false, absent: false } },
  { op: 'filled', expect: { low: true, at: true, high: true, absent: false } },
  { op: 'not_filled', expect: { low: false, at: false, high: false, absent: true } },
];

/** Скалярная ссылка (uuid): eq/ne/filled/not_filled + «пусто». */
const REF_OPS = (at: string): MatrixCase[] => [
  { op: 'eq', value: at, expect: { at: true, other: false, absent: false } },
  { op: 'ne', value: at, expect: { at: false, other: true, absent: true } },
  { op: 'eq', value: null, expect: { at: false, other: false, absent: true } },
  { op: 'ne', value: null, expect: { at: true, other: true, absent: false } },
  { op: 'filled', expect: { at: true, other: true, absent: false } },
  { op: 'not_filled', expect: { at: false, other: false, absent: true } },
];

export const MATRIX: readonly MatrixType[] = [
  {
    type: 'text',
    variants: { exact: 'КЖ1.1 Комплект', other: 'ОВ2', absent: undefined, empty: null },
    ops: [
      { op: 'eq', value: 'КЖ1.1 Комплект', expect: { exact: true, other: false, absent: false, empty: false } },
      { op: 'ne', value: 'КЖ1.1 Комплект', expect: { exact: false, other: true, absent: true, empty: true } },
      { op: 'eq', value: null, expect: { exact: false, other: false, absent: true, empty: true } },
      { op: 'ne', value: null, expect: { exact: true, other: true, absent: false, empty: false } },
      // Подстрока и регистр: значение с заглавными, искомое — строчными.
      { op: 'contains', value: 'кж1.1', expect: { exact: true, other: false, absent: false, empty: false } },
      { op: 'not_contains', value: 'кж1.1', expect: { exact: false, other: true, absent: true, empty: true } },
      { op: 'filled', expect: { exact: true, other: true, absent: false, empty: false } },
      { op: 'not_filled', expect: { exact: false, other: false, absent: true, empty: true } },
    ],
  },
  {
    type: 'long_text',
    variants: { exact: 'Комплект КЖ1.1\nВТОРОЙ ЛИСТ', other: 'Смета', absent: undefined },
    ops: [
      { op: 'eq', value: 'Комплект КЖ1.1\nВТОРОЙ ЛИСТ', expect: { exact: true, other: false, absent: false } },
      { op: 'ne', value: 'Комплект КЖ1.1\nВТОРОЙ ЛИСТ', expect: { exact: false, other: true, absent: true } },
      { op: 'contains', value: 'второй лист', expect: { exact: true, other: false, absent: false } },
      { op: 'not_contains', value: 'второй лист', expect: { exact: false, other: true, absent: true } },
      { op: 'filled', expect: { exact: true, other: true, absent: false } },
      { op: 'not_filled', expect: { exact: false, other: false, absent: true } },
    ],
  },
  {
    type: 'number',
    variants: { low: 3, at: 5, high: 10, absent: undefined },
    ops: ORDER_OPS(5),
  },
  {
    type: 'money',
    variants: {
      low: { amount: 50, currencyId: CUR_1 },
      at: { amount: 100, currencyId: CUR_1 },
      high: { amount: 150, currencyId: CUR_1 },
      otherCur: { amount: 100, currencyId: CUR_2 },
      absent: undefined,
    },
    ops: [
      { op: 'eq', value: { amount: 100, currencyId: CUR_1 }, expect: { low: false, at: true, high: false, otherCur: false, absent: false } },
      { op: 'ne', value: { amount: 100, currencyId: CUR_1 }, expect: { low: true, at: false, high: true, otherCur: true, absent: true } },
      { op: 'eq', value: null, expect: { low: false, at: false, high: false, otherCur: false, absent: true } },
      { op: 'ne', value: null, expect: { low: true, at: true, high: true, otherCur: true, absent: false } },
      // Чужая валюта несравнима: порядок — ложь даже при равной сумме.
      { op: 'gt', value: { amount: 100, currencyId: CUR_1 }, expect: { low: false, at: false, high: true, otherCur: false, absent: false } },
      { op: 'gte', value: { amount: 100, currencyId: CUR_1 }, expect: { low: false, at: true, high: true, otherCur: false, absent: false } },
      { op: 'lt', value: { amount: 100, currencyId: CUR_1 }, expect: { low: true, at: false, high: false, otherCur: false, absent: false } },
      { op: 'lte', value: { amount: 100, currencyId: CUR_1 }, expect: { low: true, at: true, high: false, otherCur: false, absent: false } },
      { op: 'filled', expect: { low: true, at: true, high: true, otherCur: true, absent: false } },
      { op: 'not_filled', expect: { low: false, at: false, high: false, otherCur: false, absent: true } },
    ],
  },
  {
    type: 'date',
    variants: { low: '2026-01-15', at: '2026-03-15', high: '2026-06-01', absent: undefined },
    ops: ORDER_OPS('2026-03-15'),
  },
  {
    type: 'datetime',
    variants: {
      low: '2026-01-15T08:00:00.000Z',
      at: '2026-03-15T10:30:00.000Z',
      high: '2026-06-01T23:59:59.000Z',
      absent: undefined,
    },
    ops: ORDER_OPS('2026-03-15T10:30:00.000Z'),
  },
  {
    type: 'duration',
    variants: { low: 30, at: 60, high: 120, absent: undefined },
    ops: ORDER_OPS(60),
  },
  {
    type: 'bool',
    variants: { at: true, absent: undefined },
    ops: [
      { op: 'eq', value: true, expect: { at: true, absent: false } },
      { op: 'ne', value: true, expect: { at: false, absent: true } },
      { op: 'eq', value: null, expect: { at: false, absent: true } },
      { op: 'ne', value: null, expect: { at: true, absent: false } },
      { op: 'filled', expect: { at: true, absent: false } },
      { op: 'not_filled', expect: { at: false, absent: true } },
    ],
  },
  {
    type: 'enum',
    variants: { at: ITEM_A, other: ITEM_B, absent: undefined },
    ops: [
      ...REF_OPS(ITEM_A),
      { op: 'in_any', value: [ITEM_A, ITEM_B], expect: { at: true, other: true, absent: false } },
      { op: 'in_any', value: [ITEM_C], expect: { at: false, other: false, absent: false } },
    ],
  },
  {
    type: 'multienum',
    variants: {
      at: [ITEM_A, ITEM_B],
      reorder: [ITEM_B, ITEM_A],
      overlap: [ITEM_B, ITEM_C],
      disjoint: [ITEM_C],
      absent: undefined,
      empty: null,
    },
    ops: [
      // eq массивов — поэлементно, порядок значим (общая грамматика значений).
      { op: 'eq', value: [ITEM_A, ITEM_B], expect: { at: true, reorder: false, overlap: false, disjoint: false, absent: false, empty: false } },
      { op: 'ne', value: [ITEM_A, ITEM_B], expect: { at: false, reorder: true, overlap: true, disjoint: true, absent: true, empty: true } },
      { op: 'in_any', value: [ITEM_A], expect: { at: true, reorder: true, overlap: false, disjoint: false, absent: false, empty: false } },
      { op: 'in_any', value: [ITEM_B, ITEM_C], expect: { at: true, reorder: true, overlap: true, disjoint: true, absent: false, empty: false } },
      { op: 'in_any', value: [ITEM_D], expect: { at: false, reorder: false, overlap: false, disjoint: false, absent: false, empty: false } },
      { op: 'filled', expect: { at: true, reorder: true, overlap: true, disjoint: true, absent: false, empty: false } },
      { op: 'not_filled', expect: { at: false, reorder: false, overlap: false, disjoint: false, absent: true, empty: true } },
    ],
  },
  {
    type: 'user',
    variants: { at: ITEM_A, other: ITEM_B, absent: undefined },
    ops: [
      ...REF_OPS(ITEM_A),
      { op: 'in_any', value: [ITEM_A, ITEM_B], expect: { at: true, other: true, absent: false } },
      { op: 'in_any', value: [ITEM_C], expect: { at: false, other: false, absent: false } },
    ],
  },
  {
    type: 'users',
    variants: {
      at: [ITEM_A, ITEM_B],
      overlap: [ITEM_B, ITEM_C],
      disjoint: [ITEM_C],
      absent: undefined,
    },
    ops: [
      { op: 'eq', value: [ITEM_A, ITEM_B], expect: { at: true, overlap: false, disjoint: false, absent: false } },
      { op: 'ne', value: [ITEM_A, ITEM_B], expect: { at: false, overlap: true, disjoint: true, absent: true } },
      { op: 'in_any', value: [ITEM_A], expect: { at: true, overlap: false, disjoint: false, absent: false } },
      { op: 'in_any', value: [ITEM_C], expect: { at: false, overlap: true, disjoint: true, absent: false } },
      { op: 'filled', expect: { at: true, overlap: true, disjoint: true, absent: false } },
      { op: 'not_filled', expect: { at: false, overlap: false, disjoint: false, absent: true } },
    ],
  },
  { type: 'department', variants: { at: DEP_1, other: DEP_2, absent: undefined }, ops: REF_OPS(DEP_1) },
  { type: 'project', variants: { at: PROJ_1, other: PROJ_2, absent: undefined }, ops: REF_OPS(PROJ_1) },
  { type: 'counterparty', variants: { at: CP_1, other: CP_2, absent: undefined }, ops: REF_OPS(CP_1) },
  { type: 'task', variants: { at: TASK_1, other: TASK_2, absent: undefined }, ops: REF_OPS(TASK_1) },
  { type: 'letter', variants: { at: LETTER_1, other: LETTER_2, absent: undefined }, ops: REF_OPS(LETTER_1) },
  { type: 'node', variants: { at: NODE_1, other: NODE_2, absent: undefined }, ops: REF_OPS(NODE_1) },
  {
    type: 'link',
    variants: {
      at: 'https://example.com/docs/KZH',
      other: '\\\\file.local\\share\\ов1',
      absent: undefined,
    },
    ops: [
      { op: 'eq', value: 'https://example.com/docs/KZH', expect: { at: true, other: false, absent: false } },
      { op: 'ne', value: 'https://example.com/docs/KZH', expect: { at: false, other: true, absent: true } },
      { op: 'contains', value: 'docs', expect: { at: true, other: false, absent: false } },
      { op: 'not_contains', value: 'docs', expect: { at: false, other: true, absent: true } },
      { op: 'filled', expect: { at: true, other: true, absent: false } },
      { op: 'not_filled', expect: { at: false, other: false, absent: true } },
    ],
  },
  {
    type: 'counter',
    variants: { at: 'Вх-2026/118', other: 'Изм. 3', absent: undefined },
    ops: [
      { op: 'eq', value: 'Вх-2026/118', expect: { at: true, other: false, absent: false } },
      { op: 'ne', value: 'Вх-2026/118', expect: { at: false, other: true, absent: true } },
      { op: 'contains', value: 'вх-2026', expect: { at: true, other: false, absent: false } },
      { op: 'not_contains', value: 'вх-2026', expect: { at: false, other: true, absent: true } },
      { op: 'filled', expect: { at: true, other: true, absent: false } },
      { op: 'not_filled', expect: { at: false, other: false, absent: true } },
    ],
  },
];
