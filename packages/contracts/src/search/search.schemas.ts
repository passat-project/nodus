import { z } from 'zod';

import { conversationTypeSchema } from '../chat/chat.schemas.js';
import { letterDirectionSchema } from '../workflows/process-type.schemas.js';

/**
 * Поиск по порталу (#952): единое окно по проекции `search_documents`.
 *
 * Контракт — форма запроса и выдачи; семантика полей:
 * - `score` — относительная уверенность 0..1, НЕ сырой `ts_rank` и не число
 *   «релевантности» для показа пользователю: интерфейс объясняет результат
 *   причинами (`reasons`), а не процентами (защита от STRESS-разбора, #272).
 * - `snippet` — текст с маркерами `SEARCH_SNIPPET_START`/`SEARCH_SNIPPET_END`
 *   вокруг совпадения; фронт рендерит только текстовые узлы, HTML не
 *   допускается (безопасность вывода).
 * - `match` — `exact` (точное совпадение/префикс ноги или FTS) и `similar`
 *   (триграммы: «похоже на», ответ владельца В1, без автозамены).
 * - `sourceCreatedAt` — дата создания источника (не правки): по ней
 *   сортировка `newest` и фильтр периода.
 *
 * Заголовки/имена (`projectName`, `counterpartyName`, `conversationLabel`,
 * `authorName`) резолвит сервер при выдаче портами модулей-владельцев;
 * в поисковой проекции хранятся только id (переименования не требуют
 * переиндексации, #952 Р9).
 */

export const SEARCH_LIMITS = {
  /** Минимум символов запроса: односимвольный запрос — шум и полный скан. */
  queryMin: 2,
  queryMax: 256,
  /** Страница выдачи (до 50, как все списки портала). */
  limitMax: 50,
  /** Окно релевантности: глубже не листаем (курсор без offset). */
  windowMax: 100,
  /** Потолок total: счётчик останавливается, флаг `totalCapped`. */
  totalCap: 1_000,
} as const;

/** Маркеры подсветки в сниппете (управляющие символы, которых нет в данных:
 *  при индексации C0-символы вырезаются, #952 Р8). */
export const SEARCH_SNIPPET_START = '\u0001';
export const SEARCH_SNIPPET_END = '\u0002';

/** Источники поиска первой версии (закрытое множество, #952 Р1). */
export const searchSourceTypeSchema = z.enum(['task', 'letter', 'message', 'project', 'employee']);
export type SearchSourceType = z.infer<typeof searchSourceTypeSchema>;

/** Тип совпадения: точное/полнотекстовое или триграммное «похоже на». */
export const searchMatchSchema = z.enum(['exact', 'similar']);
export type SearchMatch = z.infer<typeof searchMatchSchema>;

/** Почему результат оказался в выдаче (человеческие подписи — в i18n). */
export const searchReasonSchema = z.enum([
  'title',
  'body',
  'number',
  'counterparty',
  'recent',
  'participant',
]);
export type SearchReason = z.infer<typeof searchReasonSchema>;

/** Порядок выдачи: по релевантности (курсор score) или по дате источника. */
export const searchSortSchema = z.enum(['relevance', 'newest']);
export type SearchSort = z.infer<typeof searchSortSchema>;

/** Подсказка вместо «ничего не найдено»: стоп-слова или пустая проекция. */
export const searchHintSchema = z.enum(['stopwords', 'index_empty']);
export type SearchHint = z.infer<typeof searchHintSchema>;

/** `types` в query: `task,letter` (одно значение — тоже строка, не массив;
 *  принят и готовый массив — прямые вызовы схемы и тесты). */
const searchTypesParam = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== '')
      : value,
  z
    .array(searchSourceTypeSchema)
    .min(1)
    .max(5)
    // Дубли не расширяют фильтр, но ломают фасеты/подписи — массив уникален.
    .refine((types) => new Set(types).size === types.length, {
      message: 'types must be unique',
    })
    .optional(),
);

/**
 * Запрос `GET /api/v1/search`. `q` обязателен (2..256, trim);
 * `types` — фильтр по источникам (`types=task,letter`), `projectId` — по
 * проекту (задачи, письма, проекты; сообщения в v1 проектом не фильтруются —
 * #952 N7), `from`/`to` — по `sourceCreatedAt` включительно (дни UTC),
 * `cursor` — из `nextCursor`.
 */
export const searchRequestSchema = z.object({
  q: z.string().trim().min(SEARCH_LIMITS.queryMin).max(SEARCH_LIMITS.queryMax),
  types: searchTypesParam,
  projectId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  sort: searchSortSchema.default('relevance'),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_LIMITS.limitMax).default(20),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

/** Общие поля результата любого типа. */
const searchHitBase = {
  /** id источника (задача/письмо/сообщение/проект/сотрудник). */
  id: z.uuid(),
  /** Название строки: номер + тема письма, ФИО, имя проекта, заголовок задачи. */
  title: z.string(),
  /** Сниппет с маркерами `SEARCH_SNIPPET_START`/`SEARCH_SNIPPET_END`. */
  snippet: z.string(),
  /** Относительная уверенность 0..1 (наружу не сырой скор). */
  score: z.number().min(0).max(1),
  match: searchMatchSchema,
  /** Причины попадания (дедуплицированы сервером). */
  reasons: z.array(searchReasonSchema),
  /** Дата создания источника — строка «12 ноя» и сортировка `newest`. */
  sourceCreatedAt: z.iso.datetime(),
};

export const searchTaskHitSchema = z.object({
  ...searchHitBase,
  type: z.literal('task'),
  meta: z.object({
    /** Номер задачи («ПП-123» → 123); null — номер ещё не присвоен. */
    number: z.number().int().positive().nullable(),
    projectId: z.uuid().nullable(),
    projectName: z.string().nullable(),
    deadline: z.iso.datetime().nullable(),
  }),
});
export type SearchTaskHit = z.infer<typeof searchTaskHitSchema>;

export const searchLetterHitSchema = z.object({
  ...searchHitBase,
  type: z.literal('letter'),
  meta: z.object({
    regNumber: z.string().nullable(),
    counterpartyId: z.uuid().nullable(),
    counterpartyName: z.string().nullable(),
    direction: letterDirectionSchema,
  }),
});
export type SearchLetterHit = z.infer<typeof searchLetterHitSchema>;

export const searchMessageHitSchema = z.object({
  ...searchHitBase,
  type: z.literal('message'),
  meta: z.object({
    conversationId: z.uuid(),
    conversationType: conversationTypeSchema,
    /** Подпись беседы: «чат задачи ПП-123», «чат письма Вх-2026/431», название. */
    conversationLabel: z.string(),
    taskNumber: z.number().int().positive().nullable(),
    regNumber: z.string().nullable(),
    messageId: z.uuid(),
    seq: z.number().int().positive(),
    threadRootId: z.uuid().nullable(),
    authorId: z.uuid().nullable(),
    authorName: z.string().nullable(),
    createdAt: z.iso.datetime(),
  }),
});
export type SearchMessageHit = z.infer<typeof searchMessageHitSchema>;

export const searchProjectHitSchema = z.object({
  ...searchHitBase,
  type: z.literal('project'),
  meta: z.object({
    code: z.string().nullable(),
    status: z.string(),
  }),
});
export type SearchProjectHit = z.infer<typeof searchProjectHitSchema>;

export const searchEmployeeHitSchema = z.object({
  ...searchHitBase,
  type: z.literal('employee'),
  meta: z.object({
    positionName: z.string().nullable(),
    departmentName: z.string().nullable(),
    email: z.string().nullable(),
  }),
});
export type SearchEmployeeHit = z.infer<typeof searchEmployeeHitSchema>;

/** Результат поиска — дискриминированный union по `type` (UI-ветки по типу). */
export const searchHitSchema = z.discriminatedUnion('type', [
  searchTaskHitSchema,
  searchLetterHitSchema,
  searchMessageHitSchema,
  searchProjectHitSchema,
  searchEmployeeHitSchema,
]);
export type SearchHit = z.infer<typeof searchHitSchema>;

/**
 * Фасеты по типам: количества считаются по всем фильтрам, КРОМЕ выбранного
 * `types` (чипы показывают, что ещё доступно), и по полному предикату
 * совпадения — `total`/фасеты не режутся окнами поисковых ног. Выключенные
 * модулем типы отсутствуют в фасетах; панель фильтров при этом показывает
 * все пять источников портала постоянно (вердикт владельца 18.11.2026):
 * нулевые строки приглушены, а не скрыты.
 */
export const searchFacetsSchema = z.object({
  types: z.partialRecord(searchSourceTypeSchema, z.number().int().nonnegative()),
});
export type SearchFacets = z.infer<typeof searchFacetsSchema>;

export const searchResponseSchema = z.object({
  items: z.array(searchHitSchema),
  nextCursor: z.string().nullable(),
  /** Всего совпадений; счёт останавливается на `SEARCH_LIMITS.totalCap`. */
  total: z.number().int().nonnegative(),
  /** true — совпадений больше потолка счёта (`total` = потолок). */
  totalCapped: z.boolean(),
  facets: searchFacetsSchema,
  hint: searchHintSchema.nullable(),
  tookMs: z.number().int().nonnegative(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
