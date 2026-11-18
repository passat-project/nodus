import { z } from 'zod';
import { searchSourceTypeSchema, type SearchSourceType } from '@nodus/contracts';

/**
 * Порт источника поисковой проекции (#952, ADR-0012/I3).
 *
 * Модуль-владелец реализует `SearchSourceProvider` и объявляет его
 * провайдером Nest с маркером `readonly searchSourceType`; ядро `search`
 * собирает провайдеров DiscoveryService'ом и не читает чужие таблицы.
 * Провайдер отдаёт либо актуальную строку (`SearchSourceRow`), либо
 * tombstone (`deleted: true`) — удалённые/архивные/деактивированные
 * источники; индексатор проверяет `deleted` ДО любой записи.
 *
 * Семантика полей (обязательна, иначе golden-матрица видимости красная):
 * - задача: `authorId` — постановщик, `participantIds` — постановщик +
 *   ответственный + все участники, `aclKind='task'`, `confidential` — своё;
 * - письмо: `authorId` — регистратор, `participantIds` — участники
 *   обсуждения + адресат + регистратор, `aclKind='letter'`;
 * - сообщение: `conversationId` — беседа, `aclKind='conversation'`,
 *   `participantIds` пуст (доступ по беседе);
 * - проект: `projectId` — сам проект, `aclKind='project'`;
 * - сотрудник: `aclKind='portal'`.
 *
 * Заморожено после P0 (#952 §8): правка структуры — STOP.
 */

/** Вид доступа строки проекции (закрытое множество, #952 Р1). */
export const searchAclKindSchema = z.enum(['portal', 'project', 'conversation', 'task', 'letter']);
export type SearchAclKind = z.infer<typeof searchAclKindSchema>;

/** Пределы индексируемого текста (#952 Р15): body 4000, title 500. */
export const SEARCH_SOURCE_LIMITS = { title: 500, body: 4_000 } as const;

/**
 * Строка проекции. `payload` — типизированные поля источника для точной
 * ноги и meta результата (`number`, `regNumber`, `code`, `seq`...).
 */
export const searchSourceRowSchema = z.object({
  type: searchSourceTypeSchema,
  id: z.uuid(),
  title: z.string().max(SEARCH_SOURCE_LIMITS.title),
  body: z.string().max(SEARCH_SOURCE_LIMITS.body),
  keywords: z.string(),
  projectId: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  counterpartyId: z.uuid().nullable(),
  authorId: z.uuid().nullable(),
  participantIds: z.array(z.uuid()),
  confidential: z.boolean(),
  registered: z.boolean(),
  aclKind: searchAclKindSchema,
  payload: z.record(z.string(), z.unknown()),
  sourceCreatedAt: z.date(),
  sourceUpdatedAt: z.date(),
});
export type SearchSourceRow = z.infer<typeof searchSourceRowSchema>;

/** Tombstone: источник исчез/архивен — строку проекции удалить. */
export interface SearchSourceTombstone {
  type: SearchSourceType;
  id: string;
  deleted: true;
  /** Момент исчезновения: перебивает ли старую строку (идемпотентный upsert). */
  sourceUpdatedAt: Date;
}

export const searchSourceTombstoneSchema = z.object({
  type: searchSourceTypeSchema,
  id: z.uuid(),
  deleted: z.literal(true),
  sourceUpdatedAt: z.date(),
});

export const searchSourceDocumentSchema = z.union([
  searchSourceRowSchema,
  searchSourceTombstoneSchema,
]);
export type SearchSourceDocument = z.infer<typeof searchSourceDocumentSchema>;

/** Позиция полного скана (`ORDER BY source_updated_at, id`). */
export interface SearchScanCursor {
  sourceUpdatedAt: Date;
  id: string;
}

export interface SearchScanPage {
  rows: SearchSourceDocument[];
  /** null — скан закончен. */
  next: SearchScanCursor | null;
}

/**
 * Источник проекции. `load` точечно подтягивает строки по id (события,
 * точечные пересчёты), `scan` — полный проход для бэкфилла (пачками,
 * стабильный порядок `sourceUpdatedAt, id`). `loadByDepartment`/
 * `loadByPosition` — только для источников, зависящих от оргструктуры
 * (сотрудники): переименование подразделения/должности меняет их текст.
 */
export interface SearchSourceProvider {
  readonly searchSourceType: SearchSourceType;
  load(ids: string[]): Promise<SearchSourceDocument[]>;
  scan(after: SearchScanCursor | null, limit: number): Promise<SearchScanPage>;
  loadByDepartment?(departmentId: string): Promise<SearchSourceDocument[]>;
  loadByPosition?(positionId: string): Promise<SearchSourceDocument[]>;
}
