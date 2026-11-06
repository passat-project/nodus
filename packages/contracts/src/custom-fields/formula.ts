import { z } from 'zod';

/**
 * Формулы в ячейках атрибутов (#632, ADR-0037 п.3): формула — способ
 * заполнить ячейку, не тип атрибута. Ячейка хранит значение ИЛИ формулу;
 * результат формулы материализуется обычным значением атрибута, поэтому
 * фильтры, ссылки, события и виды читают его без специальных веток.
 *
 * Язык — типизированный AST из плашек редактора (не строка Excel):
 * адресация атрибутов по внутреннему `number` (переименование ничего не
 * ломает), хранение — JSON. Одна грамматика для веба, моков и сервера
 * (исключение patterns.md): редактор, валидатор и движок читают одни и те
 * же лимиты, матрицу источников и каталог функций.
 */

/** Вид записи-носителя формулы. Ячейка живёт у одной из четырёх сущностей. */
export const formulaHostKindSchema = z.enum(['task', 'letter', 'node', 'project']);
export type FormulaHostKind = z.infer<typeof formulaHostKindSchema>;

/** Сущность, у которой читается системное поле (#632): задача, письмо,
 *  проект, папка. Системные поля — название, номер, срок, рег. номер и т.п.;
 *  список — `FORMULA_SYSTEM_FIELDS` в каталоге. */
export const formulaEntitySchema = formulaHostKindSchema;
export type FormulaEntity = z.infer<typeof formulaEntitySchema>;

/** Тип значения формулы (статический тайпинг до вычисления). `ref` — id
 *  записи/сотрудника/подразделения/контрагента, `list` — массив id. */
export const formulaValueTypeSchema = z.enum([
  'number',
  'string',
  'boolean',
  'date',
  'datetime',
  'money',
  'ref',
  'list',
]);
export type FormulaValueType = z.infer<typeof formulaValueTypeSchema>;

/** Оператор AST. Символы для показа — i18n `ui.formulas.operators`. */
export const formulaOperatorSchema = z.enum([
  'add',
  'sub',
  'mul',
  'div',
  'concat',
  'eq',
  'ne',
  'lt',
  'le',
  'gt',
  'ge',
]);
export type FormulaOperator = z.infer<typeof formulaOperatorSchema>;

/** Источники одного значения (одна запись). `folder_nearest` — ближайшая
 *  папка нужного вида (включая саму запись, если она папка этого вида);
 *  `folder_chain` — вся цепочка папок от корня (агрегат, см. ниже);
 *  `ref_field` — запись, на которую указывает атрибут-ссылка. */
export const formulaSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }).strict(),
  z.object({ kind: z.literal('parent_task') }).strict(),
  z.object({ kind: z.literal('folder_nearest'), kindId: z.uuid() }).strict(),
  z.object({ kind: z.literal('folder_chain'), kindId: z.uuid() }).strict(),
  z.object({ kind: z.literal('project') }).strict(),
  z.object({ kind: z.literal('company') }).strict(),
  z.object({ kind: z.literal('ref_field'), field: z.number().int().min(1) }).strict(),
  z.object({ kind: z.literal('related'), selector: z.lazy(() => formulaSelectorSchema) }).strict(),
]);
export type FormulaSource = z.infer<typeof formulaSourceSchema>;

/** Направление связи при выборке «связанные» (from → to в `task_relations`). */
export const formulaRelationDirectionSchema = z.enum(['out', 'in', 'both']);
export type FormulaRelationDirection = z.infer<typeof formulaRelationDirectionSchema>;

/** Вид связи задач (зеркало `task_relations.kind`). */
export const formulaRelationKindSchema = z.enum(['relates', 'blocks', 'precedes', 'duplicates']);
export type FormulaRelationKind = z.infer<typeof formulaRelationKindSchema>;

/** Селектор связанных записей: подзадачи, связи, задачи папки. */
export const formulaSelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('subtasks') }).strict(),
  z
    .object({
      kind: z.literal('relations'),
      relation: formulaRelationKindSchema,
      direction: formulaRelationDirectionSchema,
    })
    .strict(),
  z.object({ kind: z.literal('node_tasks') }).strict(),
]);
export type FormulaSelector = z.infer<typeof formulaSelectorSchema>;

/** Откуда берётся выборка агрегата: связанные записи или цепочка папок. */
export const formulaAggregateFromSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('related'), selector: z.lazy(() => formulaSelectorSchema) }).strict(),
  z.object({ kind: z.literal('folder_chain'), kindId: z.uuid() }).strict(),
]);
export type FormulaAggregateFrom = z.infer<typeof formulaAggregateFromSchema>;

/** Функции-агрегаты (9): «все / хотя бы одна / сколько / последняя / сумма /
 *  уникальные / минимум / максимум / среднее». */
export const formulaAggregateFnSchema = z.enum([
  'every',
  'some',
  'count',
  'last',
  'sum',
  'unique',
  'min',
  'max',
  'avg',
]);
export type FormulaAggregateFn = z.infer<typeof formulaAggregateFnSchema>;

/** Идентификаторы функций V1 (имена в UI — русская локализация Excel). */
export const formulaFunctionIdSchema = z.enum([
  'if',
  'and',
  'or',
  'not',
  'round',
  'roundup',
  'rounddown',
  'abs',
  'left',
  'right',
  'len',
  'text',
  'year',
  'month',
  'day',
  'datedif',
]);
export type FormulaFunctionId = z.infer<typeof formulaFunctionIdSchema>;

/** Узел AST. `registry_lookup` (#636) — зарезервирован: добавится
 *  расширением union, когда появятся реестры (расширение не ломающее). */
export type FormulaNode =
  | FormulaLiteral
  | FormulaFieldRef
  | FormulaSystemField
  | FormulaOperation
  | FormulaCall
  | FormulaAggregate;

export interface FormulaLiteral {
  kind: 'literal';
  value: number | string | boolean;
}

export interface FormulaFieldRef {
  kind: 'field';
  source: FormulaSource;
  /** Внутренний номер атрибута (стабильный адрес, Р2 #631). */
  number: number;
  /** Снимок имени на момент вставки плашки: переименование не ломает
   *  формулу, а удалённый атрибут показывается в редакторе своим именем. */
  name?: string;
}

export interface FormulaSystemField {
  kind: 'system';
  source: FormulaSource;
  entity: FormulaEntity;
  /** Ключ системного поля (`title`, `deadline`, `regNumber`…). */
  key: string;
  /** Снимок подписи для плашки редактора. */
  name?: string;
}

export interface FormulaOperation {
  kind: 'op';
  op: FormulaOperator;
  args: FormulaNode[];
}

export interface FormulaCall {
  kind: 'call';
  fn: FormulaFunctionId;
  args: FormulaNode[];
}

export interface FormulaAggregate {
  kind: 'aggregate';
  from: FormulaAggregateFrom;
  fn: FormulaAggregateFn;
  /** Атрибут выборки; у «сколько» не нужен. */
  field?: number;
  /** Условие по записи выборки: `self` внутри фильтра — сама запись. */
  filter?: FormulaNode;
}

const literalSchema = z
  .object({
    kind: z.literal('literal'),
    value: z.union([
      z.number().finite(),
      // Верхняя граница схемы — потолок long_text; продуктовый лимит
      // литерала (500) проверяет checkFormulaShape точным кодом literal_text.
      z.string().max(5000),
      z.boolean(),
    ]),
  })
  .strict();

const fieldRefSchema = z
  .object({
    kind: z.literal('field'),
    source: z.lazy(() => formulaSourceSchema),
    number: z.number().int().min(1),
    name: z.string().min(1).max(60).optional(),
  })
  .strict();

const systemFieldSchema = z
  .object({
    kind: z.literal('system'),
    source: z.lazy(() => formulaSourceSchema),
    entity: formulaEntitySchema,
    key: z.string().min(1).max(40),
    name: z.string().min(1).max(60).optional(),
  })
  .strict();

const operationSchema = z
  .object({
    kind: z.literal('op'),
    op: formulaOperatorSchema,
    args: z
      .array(z.lazy(() => formulaNodeSchema))
      .min(1)
      .max(10),
  })
  .strict();

const callSchema = z
  .object({
    kind: z.literal('call'),
    fn: formulaFunctionIdSchema,
    args: z.array(z.lazy(() => formulaNodeSchema)).max(10),
  })
  .strict();

const aggregateSchema = z
  .object({
    kind: z.literal('aggregate'),
    from: z.lazy(() => formulaAggregateFromSchema),
    fn: formulaAggregateFnSchema,
    field: z.number().int().min(1).optional(),
    filter: z.lazy(() => formulaNodeSchema).optional(),
  })
  .strict();

/** Рекурсивная схема узла: глубина и размер проверяются `checkFormulaShape`
 *  (zod не умеет считать глубину без рекурсивного refine). */
export const formulaNodeSchema: z.ZodType<FormulaNode> = z.lazy(() =>
  z.union([
    literalSchema,
    fieldRefSchema,
    systemFieldSchema,
    operationSchema,
    callSchema,
    aggregateSchema,
  ]),
);
