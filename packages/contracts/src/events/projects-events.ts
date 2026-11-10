import { z } from 'zod';

import {
  CUSTOM_FIELD_LIMITS,
  customFieldChangeSchema,
} from '../custom-fields/custom-field-values.js';
import {
  projectParticipantSourceSchema,
  projectStatusSchema,
  projectVisibilitySchema,
} from '../projects/project.schemas.js';

/**
 * Каталог доменных событий модуля projects (#52, I9; каталог
 * api-conventions.md, только расширяется). Payload минимальный и клиентски
 * видим; значения для межмодульных обработчиков (crm не читает чужие
 * таблицы, I3) несёт payload: заказчик — с предыдущим значением.
 */
export const PROJECT_EVENTS = {
  CREATED: 'project.created',
  UPDATED: 'project.updated',
  /** Состав изменился действием человека (руководство/вступление/уход) или
   *  следствием смены видимости — попадает в ленту «История» (#699). */
  PARTICIPANTS_CHANGED: 'project.participants_changed',
  /** Автоматический пересчёт состава: проекция из задач и синк руководства
   *  (#699). Потребителям ростера (канал, кэш видимости, веб-инвалидация)
   *  обрабатывается наравне с participants_changed, но в историю не пишется:
   *  суть уже читается строкой изменённого поля. */
  ROSTER_SYNCED: 'project.roster_synced',
  /** Дерево проекта (#467): события узлов — они же аудит-след структуры
   *  (gateway маршрутизирует только node_updated — адресно участникам,
   *  #632: правка атрибутов папки обновляет дерево и формулы наследников;
   *  реалтайма остальных событий узлов до пилота нет). */
  NODE_CREATED: 'project.node_created',
  NODE_UPDATED: 'project.node_updated',
  NODE_MOVED: 'project.node_moved',
  NODE_DELETED: 'project.node_deleted',
  /** Каталог видов папок (#556): форма и возможности вида изменились.
   *  Каталожное событие — gateway рассылает всем в presence (О6). */
  NODE_KIND_CHANGED: 'project.node_kind_changed',
  /** Каталог типов проектов (#631, Р10): форма типа (слоты атрибутов),
   *  название, значок, цвет, архив. Каталожное — рассылается всем. */
  TYPE_CHANGED: 'project.type_changed',
} as const;

export type ProjectEventType = (typeof PROJECT_EVENTS)[keyof typeof PROJECT_EVENTS];

/** Каталожные события проектов (ADR-0030 «Дополнение (#556)»): справочные
 *  данные без персональных данных и без привязки к проекту — рассылаются
 *  всем, как каталог атрибутов (`custom_field.*`). */
export const PROJECT_CATALOG_EVENTS = [
  PROJECT_EVENTS.NODE_KIND_CHANGED,
  PROJECT_EVENTS.TYPE_CHANGED,
] as const;

export type ProjectCatalogEventType = (typeof PROJECT_CATALOG_EVENTS)[number];

/** События проекта с адресной аудиторией (#646): gateway рассылает их в
 *  user-комнаты участников, а не в общий presence — имя/шифр секретного
 *  проекта не должны утекать всем. `audience` — служебное поле, клиенту
 *  не уходит (снимает gateway). `node_updated` — с #632: правка атрибутов
 *  папки и пересчёт её формул меняют дерево и формулы типов записей-
 *  наследников; без адресной рассылки эти значения живут до F5. */
export const PROJECT_AUDIENCE_EVENTS = [
  PROJECT_EVENTS.CREATED,
  PROJECT_EVENTS.UPDATED,
  PROJECT_EVENTS.PARTICIPANTS_CHANGED,
  PROJECT_EVENTS.ROSTER_SYNCED,
  PROJECT_EVENTS.NODE_UPDATED,
] as const;

export type ProjectAudienceEventType = (typeof PROJECT_AUDIENCE_EVENTS)[number];

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
  /** Кому доставить событие (участники проекта); gateway снимает. */
  audience: z.array(z.uuid()).optional(),
});
export type ProjectCreatedPayload = z.infer<typeof projectCreatedPayloadSchema>;

/** Правка полей: список изменённых ключей + значения для обработчиков.
 *  `name` — канал проекта переименовывается («Проект: <имя>»); `status` —
 *  новое значение при статусном действии (лента «История»). */
export const projectUpdatedPayloadSchema = z.object({
  projectId: z.uuid(),
  fields: z.array(z.string()),
  name: z.string().optional(),
  /** Производный шифр (системный атрибут) — для колонок журнала/палитры. */
  code: z.string().nullable().optional(),
  status: projectStatusSchema.optional(),
  clientId: z.uuid().nullable().optional(),
  /** Прежний заказчик — crm убирает строку использования при смене/снятии. */
  previousClientId: z.uuid().nullable().optional(),
  /** Правку сделал движок формул, а не человек (#699): история помечает
   *  строку «Автоматически», актёр — лишь триггер пересчёта. */
  automatic: z.boolean().optional(),
  /** Кому доставить событие (участники проекта); gateway снимает. */
  audience: z.array(z.uuid()).optional(),
});
export type ProjectUpdatedPayload = z.infer<typeof projectUpdatedPayloadSchema>;

/** Действие над участием сотрудника (#699): добавлен, снят, смена роли. */
export const projectParticipantChangeSchema = z.object({
  userId: z.uuid(),
  action: z.enum(['added', 'removed', 'role_changed']),
  /** Источник участия до действия; null — строки не было. */
  from: projectParticipantSourceSchema.nullable(),
  /** Источник участия после действия; null — строки не стало. */
  to: projectParticipantSourceSchema.nullable(),
});
export type ProjectParticipantChange = z.infer<typeof projectParticipantChangeSchema>;

/** Причина изменения состава, видимая в истории (#699). */
export const projectParticipantsReasonSchema = z.enum(['manual', 'join', 'leave', 'visibility']);
export type ProjectParticipantsReason = z.infer<typeof projectParticipantsReasonSchema>;

/** Состав участников проекта изменился действием (#699): канал проекта
 *  пересобирает roster (Р8), вкладка «Участники» и «История» перечитываются.
 *  `changes` — семантика действий: кто добавлен/снят/сменил роль. Записи
 *  старого формата (до #699) несут только `changedUserIds`. */
export const projectParticipantsChangedPayloadSchema = z.object({
  projectId: z.uuid(),
  changedUserIds: z.array(z.uuid()),
  /** Причина; отсутствует у автоматических записей старого формата. */
  reason: projectParticipantsReasonSchema.optional(),
  /** Действия состава; пусто — запись старого формата. */
  changes: z.array(projectParticipantChangeSchema).optional(),
  /** Новое значение видимости, вызвавшей очистку состава
   *  (`reason='visibility'`). */
  visibility: projectVisibilitySchema.optional(),
  /** Кому доставить событие (участники проекта); gateway снимает. */
  audience: z.array(z.uuid()).optional(),
});
export type ProjectParticipantsChangedPayload = z.infer<
  typeof projectParticipantsChangedPayloadSchema
>;

/** Автоматический пересчёт состава (#699): проекция из задач и синк
 *  руководства. Не пишется в ленту «История» — для потребителей ростера
 *  (канал, кэш видимости) это то же изменение состава, что и
 *  `participants_changed`. */
export const projectRosterSyncedPayloadSchema = z.object({
  projectId: z.uuid(),
  changedUserIds: z.array(z.uuid()),
  /** Кому доставить событие (участники проекта); gateway снимает. */
  audience: z.array(z.uuid()).optional(),
});
export type ProjectRosterSyncedPayload = z.infer<typeof projectRosterSyncedPayloadSchema>;

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
  customFieldChanges: z.array(customFieldChangeSchema).max(CUSTOM_FIELD_LIMITS.changes).optional(),
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

/** Тип проекта изменился (#631, Р10): форма-слоты, справочные поля, архив.
 *  `form` в `fields` — слоты и привязки атрибутов перечитаны. */
export const projectTypeChangedPayloadSchema = z.object({
  typeId: z.uuid(),
  change: z.enum(['created', 'updated', 'archived', 'restored']),
  fields: z.array(z.string()),
});
export type ProjectTypeChangedPayload = z.infer<typeof projectTypeChangedPayloadSchema>;
