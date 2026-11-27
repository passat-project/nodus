/* eslint-disable nodus-internal/max-lines-warn -- один перевод #435: предикаты, сортировка, курсор, итоги и группировка — единый словарь типов/кастов, разрезание по файлам разносило бы карту типов атрибутов */
import { ErrorCode } from '@nodus/contracts';
import type {
  ConditionPredicate,
  CustomFieldDefinition,
  CustomFieldValue,
  ListEntity,
  ListField,
  ListSort,
  ListSystemField,
  ListTotal,
  MoneyValue,
} from '@nodus/contracts';
import { customFieldIdOfKey, LIST_SYSTEM_FIELDS_BY_ENTITY } from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import { escapeLikePattern } from '../database/like-pattern.js';
import { DomainException } from '../errors/domain-exception.js';

/**
 * SQL-перевод расширения списков (#435): предикаты общей выборки #635,
 * сортировка/группировка/итоги по системным полям и атрибутам `cf.<uuid>`
 * (JSONB) — чистые билдеры Prisma.Sql, без I/O. Ключевое ограничение Prisma
 * (research 27.11): orderBy/фильтры по JSONB-путям не поддерживаются — сырой
 * SQL с кастом по типу атрибута единственный путь; NULLS LAST + id tie-break
 * держат порядок детерминированным (I7), курсор — keyset по кортежу
 * (значения сортировок, id).
 *
 * Семантика значений — как у вычисления #635 (condition-logic.ts): пустое
 * значение не является значением, несовместимое хранимое — «не задано»,
 * даты/счётчики сравниваются лексикографически (ISO 8601 упорядочен),
 * деньги — по сумме той же валюты. Числовые касты защищены регулярным
 * предикатом: мусорное значение в JSONB даёт NULL, а не 500-ю.
 */

/** Определение атрибута для перевода (типа и id достаточно). */
export type ListCfDef = Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>;

/** Флаги живой стадии маршрута — индекс предикатов этапа/итога/выдачи. */
export interface CatalogStageFlag {
  id: string;
  workflowId: string;
  sortOrder: number;
  systemState: string;
  outcome: string | null;
  resultIssued: boolean;
}

/** Индекс стадий для перевода предикатов (строится из живых стадий). */
export interface StageFlagIndex {
  liveStageIds: ReadonlySet<string>;
  /** outcome → множества stage_id (живые стадии с этим итогом). */
  outcomeStages: ReadonlyMap<string, ReadonlySet<string>>;
  /** Стадии, на которых «результат выдан» (§11: отметка и все позже; без
   * отметок в маршруте — закрытые успешно). */
  issuedStageIds: ReadonlySet<string>;
}

export function buildStageFlagIndex(flags: readonly CatalogStageFlag[]): StageFlagIndex {
  const liveStageIds = new Set<string>();
  const outcomeStages = new Map<string, Set<string>>();
  const byWorkflow = new Map<string, CatalogStageFlag[]>();
  for (const flag of flags) {
    liveStageIds.add(flag.id);
    if (flag.outcome !== null) {
      const set = outcomeStages.get(flag.outcome) ?? new Set<string>();
      set.add(flag.id);
      outcomeStages.set(flag.outcome, set);
    }
    const list = byWorkflow.get(flag.workflowId) ?? [];
    list.push(flag);
    byWorkflow.set(flag.workflowId, list);
  }
  const issuedStageIds = new Set<string>();
  for (const stages of byWorkflow.values()) {
    stages.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const marked = stages.filter((s) => s.resultIssued);
    if (marked.length === 0) {
      for (const stage of stages) {
        if (stage.systemState === 'closed' && stage.outcome === 'success') {
          issuedStageIds.add(stage.id);
        }
      }
      continue;
    }
    let issued = false;
    for (const stage of stages) {
      if (stage.resultIssued) issued = true;
      if (issued) issuedStageIds.add(stage.id);
    }
  }
  return { liveStageIds, outcomeStages, issuedStageIds };
}

/** Выражение поля списка для ORDER BY/сравнений: SQL + каст параметра
 * (значение курсора/фильтра приводится к типу выражения). */
export interface FieldSql {
  expr: Prisma.Sql;
  cast: 'text' | 'numeric' | 'timestamptz';
}

/** Колонки системных предикатов сущности (у папок их нет — предикаты ложны). */
export interface SystemPredicateColumns {
  typeId?: Prisma.Sql;
  stageId?: Prisma.Sql;
  systemState?: Prisma.Sql;
}

/** Контекст перевода для одной сущности списка. */
export interface ListSqlContext {
  entity: ListEntity;
  defs: ReadonlyMap<string, ListCfDef>;
  /** SQL системных полей из LIST_SYSTEM_FIELDS_BY_ENTITY[entity]. */
  systemExpr: Readonly<Partial<Record<ListSystemField, FieldSql>>>;
  /** JSONB-колонка атрибутов (алиас таблицы внутри). */
  cfColumn: Prisma.Sql;
  /** id строки — детерминированный tie-break и хвост курсора. */
  idExpr: Prisma.Sql;
  systemPredicates: SystemPredicateColumns;
}

const FALSE = Prisma.sql`false`;
const TRUE_SQL = Prisma.sql`true`;

function invalid(field: ListField, reason: string): never {
  throw new DomainException(
    ErrorCode.LIST_FIELD_INVALID,
    'List field is not applicable',
    { field, reason },
    422,
  );
}

/** Поле существует и применимо к сущности (системное из карты, атрибут из
 * реестра). 422 — опечатка, системное поле чужой сущности, удалённый
 * атрибут: прямой запрос с таким полем отвергается (сохранённая настройка
 * с удалённым атрибутом — фильтр такого поля клиент помечает «удалён» и не
 * шлёт, колонки терпимы к пустым значениям). */
export function assertListField(field: ListField, ctx: ListSqlContext): void {
  const cfId = customFieldIdOfKey(field);
  if (cfId === null) {
    if (!(LIST_SYSTEM_FIELDS_BY_ENTITY[ctx.entity] as readonly string[]).includes(field)) {
      invalid(field, 'system_field_of_other_entity');
    }
    return;
  }
  if (!ctx.defs.has(cfId)) invalid(field, 'unknown_field');
}

/** Число в тексте JSONB (безопасный каст: мусорное значение — NULL, не 500). */
const NUMERIC_TEXT = '^-?[0-9]+(\\.[0-9]+)?([eE][+-]?[0-9]+)?$';

/** Легаси-пустота из дефисов (isDashOnlyMarker #632) — SQL-эквивалент. */
const DASH_MARKER = '^[\\s\u2010-\u2015\u2212-]+$';

function numericGuard(text: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(CASE WHEN ${text} ~ ${NUMERIC_TEXT} THEN ${text}::numeric ELSE NULL END)`;
}

function isMoneyGuard(v: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(jsonb_typeof(${v}) = 'object' AND (${v} ->> 'amount') ~ ${NUMERIC_TEXT})`;
}

/** Выражение значения атрибута по типу: числа/деньги/длительности — numeric
 * (сортировка текстом давала бы «1, 11, 2»), остальное — текст (даты ISO
 * упорядочены лексикографически, как в вычислении #635). */
function cfFieldSql(def: ListCfDef, ctx: ListSqlContext): FieldSql {
  const v = Prisma.sql`(${ctx.cfColumn} -> ${def.id})`;
  const text = Prisma.sql`(${v} #>> '{}')`;
  switch (def.type) {
    case 'number':
    case 'duration':
      return { expr: numericGuard(text), cast: 'numeric' };
    case 'money':
      // Деньги сортируются/сравниваются по сумме; валюта — только в eq/ne.
      return {
        expr: Prisma.sql`(CASE WHEN ${isMoneyGuard(v)} THEN ((${v} ->> 'amount')::numeric) ELSE NULL END)`,
        cast: 'numeric',
      };
    default:
      return { expr: text, cast: 'text' };
  }
}

/** Выражение поля (системное или атрибут) — после assertListField. */
export function fieldSql(field: ListField, ctx: ListSqlContext): FieldSql {
  const cfId = customFieldIdOfKey(field);
  if (cfId === null) {
    const expr = ctx.systemExpr[field as ListSystemField];
    if (!expr) invalid(field, 'system_field_of_other_entity');
    return expr;
  }
  const def = ctx.defs.get(cfId);
  if (!def) invalid(field, 'unknown_field');
  return cfFieldSql(def, ctx);
}

/** «Заполнено» (#635): пустая строка/дефис-маркер/пустой массив/null — не
 * заполнено; число (в т.ч. 0), `true` и деньги — заполнено. */
function filledSql(fieldId: string, ctx: ListSqlContext): Prisma.Sql {
  const v = Prisma.sql`(${ctx.cfColumn} -> ${fieldId})`;
  return Prisma.sql`(CASE jsonb_typeof(${v})
    WHEN 'string' THEN (btrim(${v} #>> '{}') <> '' AND (${v} #>> '{}') !~ ${DASH_MARKER})
    WHEN 'number' THEN true
    WHEN 'boolean' THEN ${v} = 'true'::jsonb
    WHEN 'array' THEN jsonb_array_length(${v}) > 0
    WHEN 'object' THEN true
    ELSE false
  END)`;
}

function paramCast(value: string | number, cast: FieldSql['cast']): Prisma.Sql {
  switch (cast) {
    case 'numeric':
      return Prisma.sql`${value}::numeric`;
    case 'timestamptz':
      return Prisma.sql`${value}::timestamptz`;
    default:
      return Prisma.sql`${value}::text`;
  }
}

function isMoneyValue(value: CustomFieldValue | null | undefined): value is MoneyValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as MoneyValue).amount === 'number' &&
    typeof (value as MoneyValue).currencyId === 'string'
  );
}

/** Предикат `field` по атрибуту — сравнения по типу определения. Отсутствие
 * ключа/несовместимое значение — NULL-семантика SQL даёт те же «ложно для
 * eq/порядка, истинно для ne/not_contains», что толерантное чтение #635. */
function fieldPredicateSql(
  predicate: Extract<ConditionPredicate, { kind: 'field' }>,
  ctx: ListSqlContext,
): Prisma.Sql {
  const fieldId = customFieldIdOfKey(predicate.field);
  if (fieldId === null || !ctx.defs.has(fieldId)) {
    // Удалённый атрибут в сохранённой настройке: предикат ложен — как
    // неопределённое поле в #635; список не ломается (422 отсекает только
    // assertListField на входе запроса).
    return FALSE;
  }
  const def = ctx.defs.get(fieldId)!;
  const filled = filledSql(fieldId, ctx);
  const value = predicate.value ?? null;

  switch (predicate.op) {
    case 'filled':
      return filled;
    case 'not_filled':
      return Prisma.sql`(NOT ${filled})`;
  }

  if (value === null) {
    return predicate.op === 'eq' ? Prisma.sql`(NOT ${filled})` : filled;
  }

  const v = Prisma.sql`(${ctx.cfColumn} -> ${fieldId})`;
  const rawText = Prisma.sql`(${v} #>> '{}')`;

  switch (predicate.op) {
    case 'eq':
    case 'ne': {
      let eq: Prisma.Sql;
      if (def.type === 'money') {
        if (!isMoneyValue(value)) invalid(predicate.field, 'value_type_mismatch');
        eq = Prisma.sql`(${isMoneyGuard(v)} AND ((${v} ->> 'amount')::numeric) = ${value.amount}::numeric AND (${v} ->> 'currencyId') = ${value.currencyId}::text)`;
      } else if (def.type === 'number' || def.type === 'duration') {
        if (typeof value !== 'number') invalid(predicate.field, 'value_type_mismatch');
        eq = Prisma.sql`${numericGuard(rawText)} = ${value}::numeric`;
      } else if (def.type === 'bool') {
        if (value !== true) invalid(predicate.field, 'value_type_mismatch');
        eq = Prisma.sql`${v} = 'true'::jsonb`;
      } else {
        if (typeof value !== 'string') invalid(predicate.field, 'value_type_mismatch');
        eq = Prisma.sql`${rawText} = ${value}::text`;
      }
      return predicate.op === 'eq' ? eq : Prisma.sql`(NOT (${filled} AND ${eq}))`;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const op =
        predicate.op === 'gt'
          ? '>'
          : predicate.op === 'gte'
            ? '>='
            : predicate.op === 'lt'
              ? '<'
              : '<=';
      if (def.type === 'money') {
        if (!isMoneyValue(value)) invalid(predicate.field, 'value_type_mismatch');
        // Деньги сравнимы только в одной валюте (compareValues #635).
        return Prisma.sql`(${isMoneyGuard(v)} AND (${v} ->> 'currencyId') = ${value.currencyId}::text AND ((${v} ->> 'amount')::numeric) ${Prisma.raw(op)} ${value.amount}::numeric)`;
      }
      if (def.type === 'number' || def.type === 'duration') {
        if (typeof value !== 'number') invalid(predicate.field, 'value_type_mismatch');
        return Prisma.sql`${numericGuard(rawText)} ${Prisma.raw(op)} ${value}::numeric`;
      }
      if (typeof value !== 'string') invalid(predicate.field, 'value_type_mismatch');
      return Prisma.sql`${rawText} ${Prisma.raw(op)} ${value}::text`;
    }
    case 'contains':
    case 'not_contains': {
      if (typeof value !== 'string') invalid(predicate.field, 'value_type_mismatch');
      const needle = `%${escapeLikePattern(value)}%`;
      const contains = Prisma.sql`${rawText} ILIKE ${needle}`;
      return predicate.op === 'contains'
        ? contains
        : Prisma.sql`(NOT ${filled} OR NOT ${contains})`;
    }
    case 'in_any': {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.some((item) => typeof item !== 'string')
      ) {
        invalid(predicate.field, 'value_type_mismatch');
      }
      const array = Prisma.sql`ARRAY[${Prisma.join(
        (value as string[]).map((item) => Prisma.sql`${item}::text`),
        ', ',
      )}]::text[]`;
      // Толерантное чтение (Р3): скаляр читается как массив одного элемента.
      return Prisma.sql`(CASE jsonb_typeof(${v})
        WHEN 'array' THEN ${v} ?| ${array}
        ELSE ${rawText} = ANY(${array})
      END)`;
    }
  }
}

/** Предикат общей выборки по самой записи → SQL. Семантика — condition-logic
 * (#635): ссылки на неживые стадии ложны, ошибки нет. */
export function predicateSql(
  predicate: ConditionPredicate,
  ctx: ListSqlContext,
  stages: StageFlagIndex,
): Prisma.Sql {
  switch (predicate.kind) {
    case 'type_is':
      return ctx.systemPredicates.typeId
        ? Prisma.sql`${ctx.systemPredicates.typeId} = ${predicate.typeId}::uuid`
        : FALSE;
    case 'stage_is':
      if (!ctx.systemPredicates.stageId || !stages.liveStageIds.has(predicate.stageId)) {
        return FALSE;
      }
      return Prisma.sql`${ctx.systemPredicates.stageId} = ${predicate.stageId}::uuid`;
    case 'system_state':
      return ctx.systemPredicates.systemState
        ? Prisma.sql`${ctx.systemPredicates.systemState} = ${predicate.state}::text`
        : FALSE;
    case 'outcome': {
      if (!ctx.systemPredicates.stageId) return FALSE;
      const set = stages.outcomeStages.get(predicate.outcome);
      if (!set || set.size === 0) return FALSE;
      return Prisma.sql`${ctx.systemPredicates.stageId} IN (${Prisma.join(
        [...set].map((id) => Prisma.sql`${id}::uuid`),
        ', ',
      )})`;
    }
    case 'result_issued': {
      if (!ctx.systemPredicates.stageId || stages.issuedStageIds.size === 0) return FALSE;
      return Prisma.sql`${ctx.systemPredicates.stageId} IN (${Prisma.join(
        [...stages.issuedStageIds].map((id) => Prisma.sql`${id}::uuid`),
        ', ',
      )})`;
    }
    case 'field':
      return fieldPredicateSql(predicate, ctx);
  }
}

/** Конъюнкция предикатов фильтра (пустой фильтр — TRUE). */
export function filterSql(
  filter: readonly ConditionPredicate[],
  ctx: ListSqlContext,
  stages: StageFlagIndex,
): Prisma.Sql {
  if (filter.length === 0) return TRUE_SQL;
  return Prisma.join(
    filter.map((predicate) => predicateSql(predicate, ctx, stages)),
    ' AND ',
  );
}

/** ORDER BY расширения: поля по направлению, пустые — в конец (NULLS LAST),
 * финальный tie-break по id ASC (детерминированность, I7). */
export function orderSql(sorts: readonly ListSort[], ctx: ListSqlContext): Prisma.Sql {
  const parts = sorts.map((sort) => {
    const field = fieldSql(sort.field, ctx);
    const dir = sort.dir === 'desc' ? 'DESC' : 'ASC';
    return Prisma.sql`${field.expr} ${Prisma.raw(dir)} NULLS LAST`;
  });
  parts.push(Prisma.sql`${ctx.idExpr} ASC`);
  return Prisma.join(parts, ', ');
}

/** Значение курсора ext-списка: значения полей сортировки (string|number|
 * null в порядке полей) + id строки. */
export interface ListExtCursor {
  o: (string | number | null)[];
  id: string;
}

/** Условие keyset «строго после курсора» с NULLS LAST по каждому полю:
 * NULL «больше» любого значения (и в ASC, и в DESC), равные значения
 * переходят к следующему ключу, финальный ключ — id (tie-break ASC). */
export function keysetAfterSql(
  cursor: ListExtCursor,
  sorts: readonly ListSort[],
  ctx: ListSqlContext,
): Prisma.Sql {
  if (cursor.o.length !== sorts.length) {
    throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Invalid cursor');
  }
  const keys = sorts.map((sort, index) => ({
    field: fieldSql(sort.field, ctx),
    dir: sort.dir,
    value: cursor.o[index]!,
  }));
  return afterOf(keys, cursor.id, 0, ctx);
}

function afterOf(
  keys: readonly { field: FieldSql; dir: 'asc' | 'desc'; value: string | number | null }[],
  id: string,
  index: number,
  ctx: ListSqlContext,
): Prisma.Sql {
  const { field, dir, value } = keys[index]!;
  const rest =
    index + 1 < keys.length
      ? afterOf(keys, id, index + 1, ctx)
      : Prisma.sql`${ctx.idExpr} > ${id}::uuid`;
  if (value === null) {
    // Курсор в NULL-блоке: дальше — только NULL этого ключа с большим хвостом.
    return Prisma.sql`(${field.expr} IS NULL AND ${rest})`;
  }
  const param = paramCast(value, field.cast);
  const op = Prisma.raw(dir === 'desc' ? '<' : '>');
  return Prisma.sql`(${field.expr} IS NULL OR ${field.expr} ${op} ${param} OR (${field.expr} = ${param} AND ${rest}))`;
}

/** SELECT-фрагменты агрегатов итогов: count — строки, sum/min/max — по полю
 * (sum только числовые типы атрибутов; системные числовые — number). */
export function totalSelectSql(total: ListTotal, ctx: ListSqlContext): Prisma.Sql {
  if (total.fn === 'count') return Prisma.sql`count(*)::int`;
  const field = fieldSql(total.field, ctx);
  const numeric = isNumericTotal(total.field, ctx);
  if (total.fn === 'sum') {
    if (!numeric) invalid(total.field, 'sum_of_non_numeric');
    return Prisma.sql`sum(${field.expr})::float8`;
  }
  return numeric
    ? Prisma.sql`${Prisma.raw(total.fn)}(${field.expr})::float8`
    : Prisma.sql`${Prisma.raw(total.fn)}(${field.expr})::text`;
}

/** Поле суммируемо: системный «Номер» или числовой атрибут. */
function isNumericTotal(field: ListField, ctx: ListSqlContext): boolean {
  if (field === 'number') return true;
  const cfId = customFieldIdOfKey(field);
  if (cfId === null) return false;
  const def = ctx.defs.get(cfId);
  return def?.type === 'number' || def?.type === 'duration' || def?.type === 'money';
}

/** Ключ группировки: числовые поля — float8 (число в DTO), остальные —
 * текст (ISO-даты, uuid-ссылки, метки вариантов); NULL — «без значения». */
export function groupKeySql(field: ListField, ctx: ListSqlContext): Prisma.Sql {
  const field0 = fieldSql(field, ctx);
  if (isNumericTotal(field, ctx)) return Prisma.sql`(${field0.expr})::float8`;
  return Prisma.sql`(${field0.expr})::text`;
}
