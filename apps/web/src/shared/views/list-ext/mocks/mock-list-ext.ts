import type {
  ConditionPredicate,
  CustomFieldDefinition,
  ListEntity,
  ListGroupBucket,
  ListSort,
  ListTotal,
  ListTotalValue,
} from '@nodus/contracts';
import { customFieldIdOfKey } from '@nodus/contracts';

/**
 * Движок ext-списков для MSW-моков (#435): предикаты общей выборки, сортировка
 * (NULLS LAST + id), группы и итоги — JS-зеркало серверного list-ext-sql на
 * демо-данных. Одна реализация на задачи/письма/папки: экстрактор сырого
 * значения поля — как у серверных выражений (uuid, ISO, число — числом).
 */

export type MockRowValue<T> = (row: T, field: string) => string | number | null;

export interface MockExtInput<T> {
  rows: readonly T[];
  filter: readonly ConditionPredicate[];
  sort: readonly ListSort[];
  group?: { field: string };
  totals: readonly ListTotal[];
  valueOf: MockRowValue<T>;
  definitions: readonly CustomFieldDefinition[];
}

export interface MockExtResult<T> {
  items: T[];
  groups?: ListGroupBucket[];
  totals?: ListTotalValue[];
}

/** Пусто ли значение атрибута (SQL filledSql: пустая строка/дефисы/[]/null). */
function isFilled(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'string') return raw.trim() !== '' && !/^[\s\u2010-\u2015\u2212-]+$/.test(raw);
  if (typeof raw === 'boolean') return raw === true;
  if (Array.isArray(raw)) return raw.length > 0;
  return true; // число (в т.ч. 0), объект (деньги)
}

function rawOf<T>(row: T, field: string, valueOf: MockRowValue<T>): unknown {
  const id = customFieldIdOfKey(field);
  if (id === null) return valueOf(row, field);
  const holder = row as { customFields?: Record<string, unknown> };
  return holder.customFields?.[id];
}

function textOf(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return JSON.stringify(raw);
  if (Array.isArray(raw)) return JSON.stringify(raw);
  return String(raw);
}

function numericOf(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(raw))
    return Number(raw);
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const amount = (raw as { amount?: unknown }).amount;
    if (typeof amount === 'number') return amount;
  }
  return null;
}

/** Числовое поле (суммы/мин/макс): number/duration/money — как на сервере. */
function isNumericField(field: string, definitions: readonly CustomFieldDefinition[]): boolean {
  if (field === 'number') return true;
  const id = customFieldIdOfKey(field);
  if (id === null) return false;
  const def = definitions.find((d) => d.id === id);
  return def?.type === 'number' || def?.type === 'duration' || def?.type === 'money';
}

/** Предикат по записи (JS-зеркало predicateSql). */
function evalPredicate<T>(
  row: T,
  predicate: ConditionPredicate,
  input: {
    definitions: readonly CustomFieldDefinition[];
    valueOf: MockRowValue<T>;
    entity: ListEntity;
  },
): boolean {
  const entity = input.entity;
  switch (predicate.kind) {
    case 'type_is': {
      if (entity === 'folder') return false;
      return input.valueOf(row, 'type') === predicate.typeId;
    }
    case 'stage_is':
      return input.valueOf(row, 'stage') === predicate.stageId;
    case 'system_state': {
      const holder = row as { stage?: { systemState?: string } };
      return holder.stage?.systemState === predicate.state;
    }
    case 'outcome': {
      const holder = row as { stage?: { outcome?: string | null } };
      return holder.stage?.outcome === predicate.outcome;
    }
    case 'result_issued':
      // Демо-мир журналов решений не ведёт — приближение «нет выданных».
      return false;
    case 'field': {
      const raw = rawOf(row, predicate.field, input.valueOf);
      const filled = isFilled(raw);
      const value = 'value' in predicate ? predicate.value : undefined;
      switch (predicate.op) {
        case 'filled':
          return filled;
        case 'not_filled':
          return !filled;
      }
      if (value === null || value === undefined) {
        return predicate.op === 'eq' ? !filled : filled;
      }
      const id = customFieldIdOfKey(predicate.field);
      const def = id === null ? undefined : input.definitions.find((d) => d.id === id);
      const numeric =
        def && (def.type === 'number' || def.type === 'duration' || def.type === 'money');
      switch (predicate.op) {
        case 'eq':
        case 'ne': {
          let eq: boolean;
          if (def?.type === 'money') {
            const money = value as { amount: number; currencyId: string };
            const rawMoney = raw as { amount?: unknown; currencyId?: unknown };
            eq =
              numericOf(raw) !== null &&
              rawMoney.currencyId === money.currencyId &&
              Number(rawMoney.amount) === money.amount;
          } else if (numeric) {
            eq = numericOf(raw) === Number(value);
          } else if (def?.type === 'bool') {
            eq = raw === true;
          } else {
            eq = textOf(raw) === String(value);
          }
          return predicate.op === 'eq' ? eq : !(filled && eq);
        }
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          const compare = numeric ? numericOf(raw) : textOf(raw);
          const bound = numeric ? Number(value) : String(value);
          if (compare === null || bound === null) return false;
          if (predicate.op === 'gt') return compare > bound;
          if (predicate.op === 'gte') return compare >= bound;
          if (predicate.op === 'lt') return compare < bound;
          return compare <= bound;
        }
        case 'contains':
        case 'not_contains': {
          const contains = (textOf(raw) ?? '').toLowerCase().includes(String(value).toLowerCase());
          return predicate.op === 'contains' ? contains : !filled || !contains;
        }
        case 'in_any': {
          const list = Array.isArray(value) ? value.map(String) : [];
          if (Array.isArray(raw)) return raw.some((item) => list.includes(String(item)));
          return list.includes(textOf(raw) ?? '');
        }
      }
    }
  }
}

/** Полный ext-конвейер мока: фильтр → сортировка → группы/итоги. */
export function applyMockExt<T>(input: MockExtInput<T> & { entity: ListEntity }): MockExtResult<T> {
  const { rows, filter, sort, group, totals, valueOf, definitions, entity } = input;
  const evalInput = { definitions, valueOf, entity };
  let items = rows.filter((row) => filter.every((p) => evalPredicate(row, p, evalInput)));

  const sorts: ListSort[] = group
    ? ([{ field: group.field as ListSort['field'], dir: 'asc' as const }, ...sort] as ListSort[])
    : [...sort];
  if (sorts.length > 0) {
    items = [...items].sort((a, b) => {
      for (const s of sorts) {
        const av = valueOf(a, s.field);
        const bv = valueOf(b, s.field);
        if (av === null && bv !== null) return 1;
        if (bv === null && av !== null) return -1;
        if (av !== null && bv !== null && av !== bv) {
          const result = av < bv ? -1 : 1;
          return s.dir === 'desc' ? -result : result;
        }
      }
      return (a as { id: string }).id < (b as { id: string }).id ? -1 : 1;
    });
  }

  const totalOf = (rowsOf: readonly T[], total: ListTotal): ListTotalValue['value'] => {
    if (total.fn === 'count') return rowsOf.length;
    const numeric = isNumericField(total.field, definitions);
    const values = rowsOf
      .map((row) =>
        numeric
          ? numericOf(rawOf(row, total.field, valueOf))
          : textOf(rawOf(row, total.field, valueOf)),
      )
      .filter((v): v is string | number => v !== null);
    if (values.length === 0) return null;
    if (!numeric) {
      return total.fn === 'min'
        ? values.reduce((a, b) => (a < b ? a : b))
        : total.fn === 'max'
          ? values.reduce((a, b) => (a > b ? a : b))
          : null;
    }
    const numbers = values.map((v) => Number(v));
    if (total.fn === 'sum') return numbers.reduce((acc, v) => acc + v, 0);
    if (total.fn === 'min') return numbers.reduce((a, b) => Math.min(a, b));
    return numbers.reduce((a, b) => Math.max(a, b));
  };

  const groups: ListGroupBucket[] | undefined = group
    ? (() => {
        const buckets = new Map<string | number | null, T[]>();
        for (const row of items) {
          const key = valueOf(row, group.field);
          const mapKey = key === null ? '\u0000' : key;
          const list = buckets.get(mapKey) ?? [];
          list.push(row);
          buckets.set(mapKey, list);
        }
        return [...buckets.entries()].map(([mapKey, list]) => ({
          key: mapKey === '\u0000' ? null : (mapKey as string | number),
          count: list.length,
          totals: totals.map((total) => ({
            fn: total.fn,
            value: totalOf(list, total),
          })),
        }));
      })()
    : undefined;

  const totalsValues: ListTotalValue[] | undefined =
    totals.length > 0
      ? totals.map((total) => ({ fn: total.fn, value: totalOf(items, total) }))
      : undefined;

  return {
    items,
    ...(groups ? { groups } : {}),
    ...(totalsValues ? { totals: totalsValues } : {}),
  };
}

/** Разбор ext-параметров query (JSON — как их шлёт клиент). */
export function parseMockExt(url: URL): {
  filter: ConditionPredicate[];
  sort: ListSort[];
  group?: { field: string };
  totals: ListTotal[];
} {
  const json = (key: string): unknown => {
    const raw = url.searchParams.get(key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  return {
    filter: (json('filter') as ConditionPredicate[]) ?? [],
    sort: (json('sort') as ListSort[]) ?? [],
    group: json('group') as { field: string } | undefined,
    totals: (json('totals') as ListTotal[]) ?? [],
  };
}
