import { z } from 'zod';

import { customFieldKeySchema } from '../custom-fields/custom-field-key.js';
import { customFieldValuesSchema } from '../custom-fields/custom-field-values.js';
import { cursorQuerySchema } from '../pagination/paginated.schema.js';
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
  /** Уровень настройки: в журнале — только личная, у типа — только
   * type_default, в проекте — личная или общая проектная (умолчание при
   * неуказанном — личная: безопаснее правами). */
  level: listViewLevelSchema.optional(),
  filter: listFilterSchema,
  sort: z.array(listSortSchema).max(LIST_VIEW_LIMITS.sort).default([]),
  group: listGroupSchema.optional(),
  totals: z.array(listTotalSchema).max(LIST_VIEW_LIMITS.totals).default([]),
  columns: z.array(listViewColumnSchema).max(LIST_VIEW_LIMITS.columns).default([]),
});
export type CreateSavedViewBody = z.infer<typeof createSavedViewBodySchema>;

/** Правка настройки: частичная замена разделов. Явные опциональные поля БЕЗ
 * `.default()` (gotcha Zod 4: умолчания в partial-схеме заполняли бы
 * непереданное и затирали хранимое — filter/columns «обнулялись» правкой
 * одного имени). */
export const updateSavedViewBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  entity: listEntitySchema.optional(),
  scope: listViewScopeSchema.optional(),
  level: listViewLevelSchema.optional(),
  filter: listFilterSchema.optional(),
  sort: z.array(listSortSchema).max(LIST_VIEW_LIMITS.sort).optional(),
  group: listGroupSchema.optional(),
  totals: z.array(listTotalSchema).max(LIST_VIEW_LIMITS.totals).optional(),
  columns: z.array(listViewColumnSchema).max(LIST_VIEW_LIMITS.columns).optional(),
});
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
  z.object({ status: z.literal('done'), fileId: z.uuid(), url: z.string() }),
  z.object({ status: z.literal('failed'), error: z.string() }),
]);
export type ListExportStatus = z.infer<typeof listExportStatusSchema>;

/** Ответ POST /views/export (#435): ≤1000 строк — файл готов в том же
 *  запросе (done + подписанная ссылка выдачи), больше — фоновая очередь
 *  (queued + exportId статуса). Тело запроса идемпотентно
 *  (Idempotency-Key): реплей возвращает первый статус, файл не плодится. */
export const createListExportResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('done'), fileId: z.uuid(), url: z.string() }),
  z.object({ status: z.literal('queued'), exportId: z.uuid() }),
]);
export type CreateListExportResult = z.infer<typeof createListExportResultSchema>;

/** Значение одного итога (общего или в группе). */
export const listTotalValueSchema = z.object({
  fn: z.string(),
  value: z.union([z.string(), z.number()]).nullable(),
});
export type ListTotalValue = z.infer<typeof listTotalValueSchema>;

/** Ответ списка с расширением (#435): сверх `{ items, nextCursor }` —
 *  группы и итоги, посчитанные сервером по всей видимой выборке (поля
 *  присутствуют, только когда их запросили). */
export function listResultSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().min(1).nullable(),
    groups: z.array(listGroupBucketSchema).optional(),
    totals: z.array(listTotalValueSchema).optional(),
  });
}

export interface ListResult<T> {
  items: T[];
  nextCursor: string | null;
  groups?: ListGroupBucket[];
  totals?: ListTotalValue[];
}

/** Строка списка папок проекта (#435: список папок как вкладка-список).
 *  Значения атрибутов — в customFields по id определения; ссылки гидрирует
 *  клиент из реестра определений и своих данных. */
export const folderListItemSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  parentId: z.uuid().nullable(),
  kindId: z.uuid(),
  name: z.string(),
  code: z.string().nullable(),
  customFields: customFieldValuesSchema,
  createdAt: z.iso.datetime(),
});
export type FolderListItem = z.infer<typeof folderListItemSchema>;

/** Транспорт расширения в query-параметрах GET (#435): JSON в urlencoded-
 *  строке — `?filter=%5B...%5D&sort=...&group=...&totals=...`. Честный JSON
 *  (не реляная кодировка): ext — объекты контракта, а не плоские фильтры
 *  `filter[поле]` из api-conventions. Общий парсер для задач, писем, папок. */
export function jsonQueryParam<T extends z.ZodType>(schema: T, maxBytes = 8192) {
  return z
    .string()
    .max(maxBytes)
    .transform((raw, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'invalid JSON' });
        return z.NEVER;
      }
      const result = schema.safeParse(parsed);
      if (!result.success) {
        ctx.addIssue({ code: 'custom', message: 'invalid ext payload' });
        return z.NEVER;
      }
      return result.data;
    });
}

/** Query-параметры списка папок проекта (#435): рамка проекта — путь
 *  `/projects/:id/folders`, снимается только фильтром внутри неё. */
export const listFoldersQuerySchema = cursorQuerySchema.extend({
  filter: jsonQueryParam(listFilterSchema).optional(),
  sort: jsonQueryParam(z.array(listSortSchema).max(LIST_VIEW_LIMITS.sort)).optional(),
  group: jsonQueryParam(listGroupSchema).optional(),
  totals: jsonQueryParam(z.array(listTotalSchema).max(LIST_VIEW_LIMITS.totals)).optional(),
});
export type ListFoldersQuery = z.infer<typeof listFoldersQuerySchema>;

/** Query-параметры расширения списка: каждый необязателен, вместе —
 *  listQueryExtSchema. Схемы-владельцы списков делают extend этого набора. */
export const listQueryExtParamsSchema = z.object({
  filter: jsonQueryParam(listFilterSchema),
  sort: jsonQueryParam(z.array(listSortSchema).max(LIST_VIEW_LIMITS.sort)),
  group: jsonQueryParam(listGroupSchema),
  totals: jsonQueryParam(z.array(listTotalSchema).max(LIST_VIEW_LIMITS.totals)),
});
export type ListQueryExtParams = {
  filter?: ListFilter;
  sort?: ListSort[];
  group?: ListGroup;
  totals?: ListTotal[];
};

/** Расширение присутствует в запросе? (выбор пути: ext-конвейер или
 *  прежний список). Присутствует — даже пустой: `?totals=[{"fn":"count"}]`
 *  без фильтра тоже просит итоги. */
export function hasListExt(q: ListQueryExtParams): boolean {
  return (
    q.filter !== undefined ||
    q.sort !== undefined ||
    q.group !== undefined ||
    q.totals !== undefined
  );
}

/** Нормализация params → ListQueryExt (умолчания как в контракте). */
export function toListQueryExt(q: ListQueryExtParams): ListQueryExt {
  return {
    filter: q.filter ?? [],
    sort: q.sort ?? [],
    group: q.group,
    totals: q.totals ?? [],
  };
}
