import { z } from 'zod';

import { customFieldChangeSchema } from '../custom-fields/custom-field-values.js';
import { projectStatusSchema, projectVisibilitySchema } from '../projects/project.schemas.js';

/**
 * Каталог доменных событий модуля projects (#52, I9; каталог
 * api-conventions.md, только расширяется). Payload минимальный и клиентски
 * видим; значения для межмодульных обработчиков (crm не читает чужие
 * таблицы, I3) несёт payload: заказчик — с предыдущим значением.
 */
export const PROJECT_EVENTS = {
  CREATED: 'project.created',
  UPDATED: 'project.updated',
  PARTICIPANTS_CHANGED: 'project.participants_changed',
  /** Дерево проекта (#467): события узлов — они же аудит-след структуры
   *  (gateway их не маршрутизирует: реалтайма структуры до пилота нет). */
  NODE_CREATED: 'project.node_created',
  NODE_UPDATED: 'project.node_updated',
  NODE_MOVED: 'project.node_moved',
  NODE_DELETED: 'project.node_deleted',
  /** Каталог видов папок (#556): форма и возможности вида изменились.
   *  Каталожное событие — gateway рассылает всем в presence (О6). */
  NODE_KIND_CHANGED: 'project.node_kind_changed',
} as const;

export type ProjectEventType = (typeof PROJECT_EVENTS)[keyof typeof PROJECT_EVENTS];

/** Каталожные события проектов (ADR-0030 «Дополнение (#556)»): справочные
 *  данные без персональных данных и без привязки к проекту — рассылаются
 *  всем, как каталог атрибутов (`custom_field.*`). */
export const PROJECT_CATALOG_EVENTS = [PROJECT_EVENTS.NODE_KIND_CHANGED] as const;

export type ProjectCatalogEventType = (typeof PROJECT_CATALOG_EVENTS)[number];

export const projectCreatedPayloadSchema = z.object({
  projectId: z.uuid(),
  name: z.string(),
  /** null — «тема» без шифра. */
  code: z.string().nullable(),
  managerId: z.uuid(),
  assistantIds: z.array(z.uuid()),
  /** Заказчик — контрагент (#460); проекция crm слушает. */
  clientId: z.uuid().nullable(),
  visibility: projectVisibilitySchema,
  typeId: z.uuid(),
  /** Наблюдатели, заданные при создании (просмотр без прав правки). */
  observerIds: z.array(z.uuid()).optional(),
});
export type ProjectCreatedPayload = z.infer<typeof projectCreatedPayloadSchema>;

/** Правка полей: список изменённых ключей + значения для обработчиков.
 *  `name` — канал проекта переименовывается («Проект: <имя>»); `status` —
 *  новое значение при статусном действии (лента «История»). */
export const projectUpdatedPayloadSchema = z.object({
  projectId: z.uuid(),
  fields: z.array(z.string()),
  name: z.string().optional(),
  status: projectStatusSchema.optional(),
  clientId: z.uuid().nullable().optional(),
  /** Прежний заказчик — crm убирает строку использования при смене/снятии. */
  previousClientId: z.uuid().nullable().optional(),
});
export type ProjectUpdatedPayload = z.infer<typeof projectUpdatedPayloadSchema>;

/** Состав участников проекта изменился (любой источник): канал проекта
 *  пересобирает roster (Р8), вкладка «Участники» перечитывается. */
export const projectParticipantsChangedPayloadSchema = z.object({
  projectId: z.uuid(),
  changedUserIds: z.array(z.uuid()),
});
export type ProjectParticipantsChangedPayload = z.infer<
  typeof projectParticipantsChangedPayloadSchema
>;

// ===== Дерево проекта (#467) =====

/** Узел создан (в т.ч. пакетно — по событию на каждый). */
export const projectNodeCreatedPayloadSchema = z.object({
  projectId: z.uuid(),
  nodeId: z.uuid(),
  parentId: z.uuid().nullable(),
  kindId: z.uuid(),
  name: z.string(),
});
export type ProjectNodeCreatedPayload = z.infer<typeof projectNodeCreatedPayloadSchema>;

/** Правка узла: имя/код/вид/значения; fields — изменённые ключи, включая
 *  `cf.<id>` изменённых атрибутов (канон ADR-0029: значения — в событии
 *  изменения сущности, `long_text` обрезан до 500). */
export const projectNodeUpdatedPayloadSchema = z.object({
  projectId: z.uuid(),
  nodeId: z.uuid(),
  fields: z.array(z.string()),
  name: z.string().optional(),
  code: z.string().nullable().optional(),
  kindId: z.uuid().optional(),
  /** Изменения значений атрибутов (≤ 50): потребитель #38 — правила схемы. */
  customFieldChanges: z.array(customFieldChangeSchema).optional(),
});
export type ProjectNodeUpdatedPayload = z.infer<typeof projectNodeUpdatedPayloadSchema>;

/** Перенос узла (DnD): прежний и новый родитель (null — корень). */
export const projectNodeMovedPayloadSchema = z.object({
  projectId: z.uuid(),
  nodeId: z.uuid(),
  parentId: z.uuid().nullable(),
  previousParentId: z.uuid().nullable(),
});
export type ProjectNodeMovedPayload = z.infer<typeof projectNodeMovedPayloadSchema>;

/** Узел удалён насовсем (узлы без архивации; пустой — вердикт 30.10). */
export const projectNodeDeletedPayloadSchema = z.object({
  projectId: z.uuid(),
  nodeId: z.uuid(),
  parentId: z.uuid().nullable(),
});
export type ProjectNodeDeletedPayload = z.infer<typeof projectNodeDeletedPayloadSchema>;

/** Вид папки изменился (#556, Р10): форма или возможности. `fields` —
 *  изменённые ключи (`form`, `capabilities`, `name`, `icon`, `color`,
 *  `archivedAt`); `form` — для переписи обработчиком удаления атрибута. */
export const projectNodeKindChangedPayloadSchema = z.object({
  kindId: z.uuid(),
  change: z.enum(['created', 'updated', 'archived', 'restored']),
  fields: z.array(z.string()),
});
export type ProjectNodeKindChangedPayload = z.infer<typeof projectNodeKindChangedPayloadSchema>;
