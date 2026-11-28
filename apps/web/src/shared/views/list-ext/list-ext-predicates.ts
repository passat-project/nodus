import type { ConditionPredicate, CustomFieldDefinition } from '@nodus/contracts';
import { customFieldIdOfKey, customFieldKey } from '@nodus/contracts';

import { isActiveFilter, type FilterState, type FilterValue } from '../list-filters.js';

/**
 * Перевод значений атрибутных полей панели фильтра в предикаты общей выборки
 * #635 (#435): панель пишет их в ту же FilterState (чипы/пресеты не меняются),
 * а ext-список шлёт на сервер. Грамматика ввода — прежние контролы панели
 * (диапазоны дат/чисел, справочники, сотрудник): диапазон становится парой
 * gte/lte (конъюнкция), справочник — eq, мультивыбор/несколько людей — in_any.
 *
 * Поля, которые перевести нельзя (деньги без валюты в настройках атрибута),
 * остаются клиентскими: перевод возвращает null, потребитель не исключает их
 * из локальной фильтрации. Удалённый атрибут (нет определения) на сервер НЕ
 * шлётся (422 LIST_FIELD_INVALID) и помечается в панели.
 */

/** Дата диапазона «по» с запасом до конца суток: значения хранятся и датой,
 *  и полным ISO, сравнение на сервере текстовое — «2026-10-31T08:00» не
 *  проходит лексикографическое <= «2026-10-31». */
const END_OF_DAY = 'T23:59:59.999';

function fieldPredicate(
  field: `cf.${string}`,
  op: 'gte' | 'lte',
  value: number | string,
): ConditionPredicate {
  return { kind: 'field', field, op, value };
}

/** Предикаты одного атрибутного поля панели; null — поле остаётся клиентским. */
function predicatesOf(
  definition: CustomFieldDefinition,
  value: FilterValue,
): ConditionPredicate[] | null {
  const field = customFieldKey(definition.id);
  const range =
    typeof value === 'object' && value !== undefined
      ? (value as { from?: number | string; to?: number | string })
      : undefined;

  switch (definition.type) {
    case 'text':
    case 'long_text':
    case 'link':
    case 'counter':
      return typeof value === 'string' && value !== ''
        ? [{ kind: 'field', field, op: 'contains', value }]
        : [];
    case 'number':
    case 'duration': {
      if (!range) return [];
      const predicates: ConditionPredicate[] = [];
      if (typeof range.from === 'number') predicates.push(fieldPredicate(field, 'gte', range.from));
      if (typeof range.to === 'number') predicates.push(fieldPredicate(field, 'lte', range.to));
      return predicates;
    }
    case 'money': {
      // Деньги сравнимы только в одной валюте (семантика #635): без явной
      // валюты в настройках атрибута предикат не построить — фильтр
      // остаётся клиентским.
      const currencyId = definition.settings.currencyId;
      if (!currencyId) return null;
      if (!range) return [];
      const predicates: ConditionPredicate[] = [];
      if (typeof range.from === 'number')
        predicates.push({
          kind: 'field',
          field,
          op: 'gte',
          value: { amount: range.from, currencyId },
        });
      if (typeof range.to === 'number')
        predicates.push({
          kind: 'field',
          field,
          op: 'lte',
          value: { amount: range.to, currencyId },
        });
      return predicates;
    }
    case 'date':
    case 'datetime': {
      if (!range) return [];
      const predicates: ConditionPredicate[] = [];
      if (typeof range.from === 'string' && range.from !== '')
        predicates.push(fieldPredicate(field, 'gte', range.from));
      if (typeof range.to === 'string' && range.to !== '')
        predicates.push(fieldPredicate(field, 'lte', range.to + END_OF_DAY));
      return predicates;
    }
    case 'bool':
      return typeof value === 'string'
        ? // «нет» — НЕ заполнено: eq с null (пустое значение — не значение).
          [{ kind: 'field', field, op: 'eq', value: value === 'true' ? true : null }]
        : [];
    case 'enum':
    case 'department':
    case 'project':
      return typeof value === 'string' && value !== ''
        ? [{ kind: 'field', field, op: 'eq', value }]
        : [];
    case 'multienum':
      return typeof value === 'string' && value !== ''
        ? [{ kind: 'field', field, op: 'in_any', value: [value] }]
        : [];
    case 'user':
      return typeof value === 'string' && value !== ''
        ? [{ kind: 'field', field, op: 'eq', value }]
        : [];
    case 'users':
      return typeof value === 'string' && value !== ''
        ? [{ kind: 'field', field, op: 'in_any', value: [value] }]
        : [];
    // Ссылки на записи и контрагент: фильтра в панели нет (filter-defs).
    case 'counterparty':
    case 'task':
    case 'letter':
    case 'node':
      return [];
  }
}

/** Атрибутные поля панели, ушедшие на сервер (остальные — локальные). */
export interface AttributeFilterSplit {
  predicates: ConditionPredicate[];
  /** id полей (cf.…), чьи значения переведены в предикаты. */
  serverFieldIds: Set<string>;
  /** id полей с удалённым атрибутом — не шлюсятся, панель помечает «удалён». */
  removedFieldIds: Set<string>;
}

/** Разделение атрибутных фильтров панели на серверные предикаты и остаток:
 *  идёт по ЗНАЧЕНИЯМ состояния (ключи cf.*), а не по реестру дефов — реестр
 *  собирается из загруженных строк и на первом рендере ещё пуст, а предикаты
 *  нужны самому запросу строк (иначе цикл). */
export function splitAttributeFilter(
  state: FilterState,
  definitions: readonly CustomFieldDefinition[],
): AttributeFilterSplit {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const predicates: ConditionPredicate[] = [];
  const serverFieldIds = new Set<string>();
  const removedFieldIds = new Set<string>();
  for (const [fieldId, value] of Object.entries(state)) {
    const id = customFieldIdOfKey(fieldId);
    if (id === null) continue; // системное поле журнала — клиентское, как было
    if (!isActiveFilter(value)) continue;
    const definition = byId.get(id);
    if (!definition) {
      removedFieldIds.add(fieldId);
      continue;
    }
    const translated = predicatesOf(definition, value);
    if (translated === null || translated.length === 0) continue;
    predicates.push(...translated);
    serverFieldIds.add(fieldId);
  }
  return { predicates, serverFieldIds, removedFieldIds };
}

/** Жив ли атрибут поля (удалённый — false). */
function isLiveField(field: string, definitions: readonly CustomFieldDefinition[]): boolean {
  const id = customFieldIdOfKey(field);
  return id === null ? true : definitions.some((d) => d.id === id);
}

/** Удалённые атрибуты из настройки вида (#435): предикаты и сортировки такого
 *  поля НЕ шлются (сервер — 422 LIST_FIELD_INVALID), список не ломается. */
export function sanitizeSavedViewExt<
  V extends {
    filter: readonly ConditionPredicate[];
    sort: readonly { field: string; dir?: unknown }[];
    group?: { field: string };
    totals: readonly { fn: string; field?: string }[];
  },
>(view: V, definitions: readonly CustomFieldDefinition[]): V {
  return {
    ...view,
    filter: view.filter.filter((p) => p.kind !== 'field' || isLiveField(p.field, definitions)),
    sort: view.sort.filter((s) => isLiveField(s.field, definitions)),
    group: view.group && isLiveField(view.group.field, definitions) ? view.group : undefined,
    totals: view.totals.filter(
      (t) => t.fn === 'count' || (t.field !== undefined && isLiveField(t.field, definitions)),
    ),
  };
}
