import { z } from 'zod';

import { customFieldKeySchema } from '../custom-fields/custom-field-key.js';
import { CONDITION_LIMITS, conditionPredicateSchema } from '../workflows/condition-query.js';

/**
 * Расширенный фильтр и виды списков (#435, unified-model §7/§12): список —
 * не реестр и не раздел «Виды»; вид — СОХРАНЁННАЯ настройка списка (условия,
 * колонки, группировка, итоги). Условия строки — предикаты общей выборки
 * #635 (субъект «сам(á) запись», конъюнкция): второго языка условий нет.
 * Фильтр, сортировка, группировка и итоги считает СЕРВЕР по всей выборке
 * («сервер проверяет сам»/«списки считаются на сервере»), видимость строк —
 * одна с карточками; порядок детерминирован (NULLS LAST + id).
 */

export const LIST_VIEW_LIMITS = {
  /** Условий фильтра списка (И) — как предикаты выборки #635. */
  predicates: CONDITION_LIMITS.predicates,
  /** Колонок в виде (системные + атрибуты). */
  columns: 50,
  /** Полей сортировки (детерминированный tie-break по id — всегда). */
  sort: 2,
  /** Итогов (считаются по всей видимой выборке). */
  totals: 6,
  /** Строк синхронной выгрузки CSV; больше — фоновая очередь (#435). */
  csvSyncRows: 1000,
} as const;

/** CSV-выгрузка (#435): русский Excel — UTF-8 c BOM и «;». */
export const CSV_EXPORT = {
  bom: '\uFEFF',
  delimiter: ';',
} as const;

/** Строки списка: задачи, письма, папки (строки реестров добавит #636). */
export const listEntitySchema = z.enum(['task', 'letter', 'folder']);
export type ListEntity = z.infer<typeof listEntitySchema>;

/** Системные поля списков (сводный словарь; применимость по сущности —
 *  картой ниже). `decidedBy`/`decidedAt` — «кто решил / когда» из журнала
 *  переходов (#435: колонки решения). */
export const listSystemFieldSchema = z.enum([
  'number',
  'title',
  'stage',
  'deadline',
  'createdAt',
  'assignee',
  'type',
  'project',
  'folder',
  'decidedBy',
  'decidedAt',
  'regNumber',
  'correspondent',
  'sentAt',
  'name',
  'kind',
]);
export type ListSystemField = z.infer<typeof listSystemFieldSchema>;

/** Системные поля, имеющие смысл у сущности списка: чего нет — панель не
 *  предлагает, серверное указание чужого — 422. */
export const LIST_SYSTEM_FIELDS_BY_ENTITY = {
  task: [
    'number',
    'title',
    'stage',
    'deadline',
    'createdAt',
    'assignee',
    'type',
    'project',
    'folder',
    'decidedBy',
    'decidedAt',
  ],
  letter: [
    'regNumber',
    'correspondent',
    'sentAt',
    'createdAt',
    'assignee',
    'type',
    'project',
    'stage',
  ],
  folder: ['name', 'kind', 'createdAt'],
} as const satisfies Record<ListEntity, readonly ListSystemField[]>;

/** Поле списка — системный ключ или атрибут `cf.<uuid>`; сортировка,
 *  группировка, итоги и колонки адресуют поля ОДИНАКОВО. */
export const listFieldSchema = z.union([listSystemFieldSchema, customFieldKeySchema]);
export type ListField = z.infer<typeof listFieldSchema>;

/** Фильтр списка: конъюнкция предикатов общей выборки по самой записи. */
export const listFilterSchema = z
  .array(conditionPredicateSchema)
  .max(LIST_VIEW_LIMITS.predicates)
  .default([]);
export type ListFilter = z.infer<typeof listFilterSchema>;

/** Направление сортировки. Пустые значения — всегда в конец (NULLS LAST),
 *  детерминированность — tie-break по id сервера. */
export const listSortDirSchema = z.enum(['asc', 'desc']);
export const listSortSchema = z.object({
  field: listFieldSchema,
  dir: listSortDirSchema,
});
export type ListSort = z.infer<typeof listSortSchema>;

/** Группировка списка по одному полю: группы (ключ, счётчик, итоги) считает
 *  сервер по всей выборке; строки идут отсортированными по полю группировки
 *  первыми — постраничная догрузка не рушит состав групп. */
export const listGroupSchema = z.object({ field: listFieldSchema });
export type ListGroup = z.infer<typeof listGroupSchema>;

/** Итог по всей видимой выборке: количество строк или агрегат поля. */
export const listTotalSchema = z.discriminatedUnion('fn', [
  z.object({ fn: z.literal('count') }),
  z.object({ fn: z.enum(['sum', 'min', 'max']), field: listFieldSchema }),
]);
export type ListTotal = z.infer<typeof listTotalSchema>;

/** Колонка вида: поле + личная геометрия (ширина фиксируется персональными
 *  настройками пользователя, вид хранит состав и порядок). */
export const listViewColumnSchema = z.object({
  field: listFieldSchema,
});
export type ListViewColumn = z.infer<typeof listViewColumnSchema>;

/** Расширение запроса списка (#435): фильтр/сортировка/группировка/итоги
 *  поверх существующих курсорных списков задач/писем/папок. */
export const listQueryExtSchema = z.object({
  filter: listFilterSchema,
  sort: z.array(listSortSchema).max(LIST_VIEW_LIMITS.sort).default([]),
  group: listGroupSchema.optional(),
  totals: z.array(listTotalSchema).max(LIST_VIEW_LIMITS.totals).default([]),
});
export type ListQueryExt = z.infer<typeof listQueryExtSchema>;

/** Группа выдачи: ключ (значение поля группировки, null — «без значения»),
 *  счётчик строк и итоги по группе. */
export const listGroupBucketSchema = z.object({
  key: z.union([z.string(), z.number()]).nullable(),
  count: z.number().int().min(0),
  totals: z.array(
    z.object({ fn: z.string(), value: z.union([z.string(), z.number()]).nullable() }),
  ),
});
export type ListGroupBucket = z.infer<typeof listGroupBucketSchema>;

/** Рамка вида (#435: «рамку снять нельзя»): журнал раздела, проект (только
 *  записи этого проекта) или список типа по умолчанию. */
export const listViewScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('journal') }),
  z.object({ kind: z.literal('project'), projectId: z.uuid() }),
  z.object({ kind: z.literal('type_default'), typeId: z.uuid() }),
]);
export type ListViewScope = z.infer<typeof listViewScopeSchema>;

/** Уровень сохранённой настройки: личная (любой участник), проектная общая
 *  (руководство проекта), список типа по умолчанию (настройщик процессов). */
export const listViewLevelSchema = z.enum(['personal', 'project', 'type_default']);
export type ListViewLevel = z.infer<typeof listViewLevelSchema>;

/** Сохранённый вид — настройка списка (#435): имя, сущность, рамка, уровень
 *  и сама настройка (условия/колонки/группировка/итоги/сортировка). Поисковый
 *  запрос вида НЕ хранит (живёт в сессии поиска, шов #272). Удалённый
 *  атрибут в настройке — пометка «удалён», список не ломает. */
export const savedViewSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  entity: listEntitySchema,
  scope: listViewScopeSchema,
  level: listViewLevelSchema,
  filter: listFilterSchema,
  sort: z.array(listSortSchema).max(LIST_VIEW_LIMITS.sort).default([]),
  group: listGroupSchema.optional(),
  totals: z.array(listTotalSchema).max(LIST_VIEW_LIMITS.totals).default([]),
  columns: z.array(listViewColumnSchema).max(LIST_VIEW_LIMITS.columns).default([]),
  createdAt: z.iso.datetime(),
  createdBy: z.uuid().nullable(),
});
export type SavedView = z.infer<typeof savedViewSchema>;

export const createSavedViewBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  entity: listEntitySchema,
  scope: listViewScopeSchema,
  filter: listFilterSchema,
  sort: z.array(listSortSchema).max(LIST_VIEW_LIMITS.sort).default([]),
  group: listGroupSchema.optional(),
  totals: z.array(listTotalSchema).max(LIST_VIEW_LIMITS.totals).default([]),
  columns: z.array(listViewColumnSchema).max(LIST_VIEW_LIMITS.columns).default([]),
});
export type CreateSavedViewBody = z.infer<typeof createSavedViewBodySchema>;

export const updateSavedViewBodySchema = createSavedViewBodySchema.partial();
export type UpdateSavedViewBody = z.infer<typeof updateSavedViewBodySchema>;

/** Выгрузка CSV текущей выборки и колонок (#435): до csvSyncRows — файл
 *  сразу; больше — фоновая очередь, статус по exportId, готовый файл —
 *  обычной файловой выдачей (files). Выгружается то, что на экране:
 *  та же видимость и рамка. */
export const createListExportBodySchema = z.object({
  entity: listEntitySchema,
  scope: listViewScopeSchema,
  filter: listFilterSchema,
  sort: z.array(listSortSchema).max(LIST_VIEW_LIMITS.sort).default([]),
  columns: z.array(listViewColumnSchema).min(1).max(LIST_VIEW_LIMITS.columns),
});
export type CreateListExportBody = z.infer<typeof createListExportBodySchema>;

export const listExportStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('queued') }),
  z.object({ status: z.literal('running') }),
  z.object({ status: z.literal('done'), fileId: z.uuid() }),
  z.object({ status: z.literal('failed'), error: z.string() }),
]);
export type ListExportStatus = z.infer<typeof listExportStatusSchema>;
