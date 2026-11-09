import { z } from 'zod';

import {
  customFieldChangeSchema,
  CUSTOM_FIELD_LIMITS,
} from '../custom-fields/custom-field-values.js';
import { lockEditorsSchema } from '../forms/field-lock.js';

/**
 * Каталог доменных событий модуля tasks (I9; каталог api-conventions.md,
 * только расширяется). Payload минимальный и клиентски видим (gateway
 * рассылает те же события). `audience` — пользователи, которым событие
 * доставляется в user-комнаты (постановщик, ответственный, соисполнители,
 * наблюдатели; при снятии участника — включая снятого, чтобы его клиент
 * убрал задачу); поле служебное — gateway вырезает его до отправки клиенту
 * (#328). Клиент применяет событие как сигнал к инвалидации кэша.
 */
export const TASK_EVENTS = {
  CREATED: 'task.created',
  UPDATED: 'task.updated',
  STAGE_CHANGED: 'task.stage_changed',
  STATUS_CHANGED: 'task.status_changed',
  PERSONAL_STAGE_CHANGED: 'task.personal_stage_changed',
  ASSIGNED: 'task.assigned',
  PARTICIPANTS_CHANGED: 'task.participants_changed',
  CHECKLIST_CHANGED: 'task.checklist_changed',
  COMPLETED: 'task.completed',
  OVERDUE: 'task.overdue',
  TIME_LOGGED: 'task.time_logged',
  TIMER_STARTED: 'task.timer_started',
  TIMER_STOPPED: 'task.timer_stopped',
  RESULT_SET: 'task.result_set',
  RELATION_CHANGED: 'task.relation_changed',
  DELETED: 'task.deleted',
  PERSONAL_STAGE_CREATED: 'task.personal_stage_created',
  PERSONAL_STAGE_UPDATED: 'task.personal_stage_updated',
  PERSONAL_STAGE_ARCHIVED: 'task.personal_stage_archived',
  /** Пересчитан счётчик комментариев (сообщений беседы задачи, #252):
   *  клиент ставит точное значение без рефеча досок. */
  COMMENTS_COUNTED: 'task.comments_counted',
  /** Задачное: смена типа у задачи (audience — участники, #378). */
  TYPE_CHANGED: 'task.type_changed',
} as const;

export type TaskEventType = (typeof TASK_EVENTS)[keyof typeof TASK_EVENTS];

/** Общая часть payload событий задачи. */
export const taskEventBaseSchema = z.object({
  taskId: z.uuid(),
  number: z.number().int().min(1),
  audience: z.array(z.uuid()),
});
export type TaskEventBase = z.infer<typeof taskEventBaseSchema>;

export const taskCreatedPayloadSchema = taskEventBaseSchema.extend({
  title: z.string(),
  creatorId: z.uuid(),
  assigneeId: z.uuid(),
  coexecutorIds: z.array(z.uuid()),
  observerIds: z.array(z.uuid()),
  projectId: z.uuid().nullable(),
  parentId: z.uuid().nullable(),
  /** Узел структуры (#467/#632): агрегаты «задачи папки» у формул. */
  nodeId: z.uuid().nullable().optional(),
  source: z.enum(['manual', 'chat_message', 'letter']),
  sourceId: z.uuid().nullable(),
});
export type TaskCreatedPayload = z.infer<typeof taskCreatedPayloadSchema>;

/** Правка полей: список изменённых ключей (значения — дочитываются API).
 *  Кастомные поля (#431): в `fields` — ключи `cf.<id>`, реальные изменения
 *  значений — в `customFieldChanges` (long_text обрезан до 500, ≤ 50).
 *  `projectId`/`previousProjectId` (#52): перенос задачи между проектами —
 *  обе проекции участников пересчитываются (optional — старые события).
 *  `nodeId`/`previousNodeId` (#467): перенос задачи между узлами дерева
 *  проекта; смена проекта обнуляет узел (nodeId=null). */
export const taskUpdatedPayloadSchema = taskEventBaseSchema.extend({
  fields: z.array(z.string()),
  title: z.string().optional(),
  deadline: z.iso.datetime().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  previousProjectId: z.uuid().nullable().optional(),
  nodeId: z.uuid().nullable().optional(),
  previousNodeId: z.uuid().nullable().optional(),
  /** Родитель (#632): агрегат подзадач пересчитывается у старого и нового. */
  parentId: z.uuid().nullable().optional(),
  previousParentId: z.uuid().nullable().optional(),
  customFieldChanges: z.array(customFieldChangeSchema).max(CUSTOM_FIELD_LIMITS.changes).optional(),
  /** Формульная запись (#632): значение посчитано пересчётом ПОСЛЕ правки
   *  источника — клиент обязан перечитать деталь даже у автора мутации. */
  formulaWrite: z.boolean().optional(),
  /** Поставленные/тронутые замки (#496, Р4/Р9): ручная правка закреплённого
   *  (PATCH, окно кнопки) и нажатие кнопки с «Закрепить после нажатия».
   *  `fields` содержит `'locks'`, `customFieldChanges` при этом нет —
   *  пересчёт формул на таком payload ничего не делает. Окно создания
   *  кладёт замки в саму строку `task.created`. */
  locks: z
    .array(z.object({ key: z.string().min(1).max(64), editors: lockEditorsSchema }))
    .max(30)
    .optional(),
  /** Причина ручной правки закреплённого (#496, Р4): постановщик или право
   *  `task.edit_locked` — история и аудит; приходит вместе с `locks`. */
  lockReason: z.string().max(500).optional(),
});
export type TaskUpdatedPayload = z.infer<typeof taskUpdatedPayloadSchema>;

export const taskStageChangedPayloadSchema = taskEventBaseSchema.extend({
  fromStageId: z.uuid(),
  toStageId: z.uuid(),
  toStageName: z.string(),
  fromState: z.string(),
  toState: z.string(),
  /** Итог целевой стадии, если она в этапе «Итог» (#378/#430; optional —
   *  старые события журнала не несут поля). */
  toStageOutcome: z.enum(['success', 'cancelled', 'rejected']).nullable().optional(),
  /** Почему сменилась стадия: кнопка маршрута / перенос публикации /
   *  смена типа (#378, ADR-0021). */
  cause: z.enum(['transition', 'workflow_migration', 'type_change']).optional(),
  transitionId: z.uuid().nullable(),
  /** Гейт пройден обходом с причиной (task.override_gate). */
  overriddenGates: z.array(z.string()).optional(),
  /** Текст причины обхода гейта («Выполнить всё равно») — история и аудит
   *  (ADR-0020); есть только вместе с overriddenGates. */
  reason: z.string().max(500).optional(),
  creatorId: z.uuid(),
  assigneeId: z.uuid(),
  /** Соисполнители — адресаты «задача отменена» (наблюдатели — без звука). */
  coexecutorIds: z.array(z.uuid()).optional(),
  /** Решающие нового статуса (#433) — адресаты «Ждёт вашего решения» и
   *  получатели realtime-инвалидации; уже отфильтрованы по видимости.
   *  Потолок — предохранитель от раздувания события. */
  deciderIds: z.array(z.uuid()).max(200).optional(),
  /** Журнал перехода (#380): id строки `transition_records`; блок в чате
   *  пишется только для событий с ним (старые события его не несут). */
  recordId: z.uuid().optional(),
  /** Названия для блока перехода в чате (лимиты — контракт блока). */
  transitionName: z.string().min(1).max(32).optional(),
  fromStageName: z.string().min(1).max(40).optional(),
  /** Текст раздела «Причина / комментарий» окна перехода и его подпись. */
  comment: z.string().max(2000).optional(),
  commentLabel: z.string().max(60).optional(),
  /** Итог, созданный переходом: файлы считаются по живым вложениям. */
  result: z
    .object({
      resultId: z.uuid(),
      fileCount: z.number().int().min(0),
      messageCount: z.number().int().min(0).max(50),
    })
    .optional(),
});
export type TaskStageChangedPayload = z.infer<typeof taskStageChangedPayloadSchema>;

export const taskAssignedPayloadSchema = taskEventBaseSchema.extend({
  title: z.string(),
  assigneeId: z.uuid(),
  previousAssigneeId: z.uuid().nullable(),
  /** Проект задачи (#52): проекция участников проекта слушает. */
  projectId: z.uuid().nullable(),
});
export type TaskAssignedPayload = z.infer<typeof taskAssignedPayloadSchema>;

export const taskParticipantsChangedPayloadSchema = taskEventBaseSchema.extend({
  title: z.string(),
  added: z.array(z.object({ userId: z.uuid(), role: z.enum(['coexecutor', 'observer']) })),
  removed: z.array(z.uuid()),
  /** Проект задачи (#52): проекция участников проекта слушает. */
  projectId: z.uuid().nullable(),
  /** Причина правки закреплённых участников (#496, Р4). */
  lockReason: z.string().max(500).optional(),
});
export type TaskParticipantsChangedPayload = z.infer<typeof taskParticipantsChangedPayloadSchema>;

/** Удаление задачи: проекции (канал, участники проекта) распускают состав. */
export const taskDeletedPayloadSchema = taskEventBaseSchema.extend({
  projectId: z.uuid().nullable(),
  /** Место удалённой задачи (#632): формулы папки/подзадач пересчитываются. */
  nodeId: z.uuid().nullable().optional(),
  parentId: z.uuid().nullable().optional(),
});
export type TaskDeletedPayload = z.infer<typeof taskDeletedPayloadSchema>;

export const taskOverduePayloadSchema = taskEventBaseSchema.extend({
  title: z.string(),
  deadline: z.iso.datetime(),
  creatorId: z.uuid(),
  assigneeId: z.uuid(),
});
export type TaskOverduePayload = z.infer<typeof taskOverduePayloadSchema>;

export const taskTimeLoggedPayloadSchema = taskEventBaseSchema.extend({
  entryId: z.uuid(),
  userId: z.uuid(),
  minutes: z.number().int(),
  spentMinutes: z.number().int(),
});
export type TaskTimeLoggedPayload = z.infer<typeof taskTimeLoggedPayloadSchema>;

/** Личный маршрут «Мой план»: событие только владельцу (audience = [owner]). */
export const taskPersonalStageEventPayloadSchema = z.object({
  stageId: z.uuid(),
  audience: z.array(z.uuid()),
});
export type TaskPersonalStageEventPayload = z.infer<typeof taskPersonalStageEventPayloadSchema>;

/** Счётчик комментариев задачи (#252): точное значение после пересчёта. */
export const taskCommentsCountedPayloadSchema = taskEventBaseSchema.extend({
  commentsCount: z.number().int().min(0),
});
export type TaskCommentsCountedPayload = z.infer<typeof taskCommentsCountedPayloadSchema>;

/** Смена типа задачи (#378): задачное событие с обычной аудиторией; стадия
 *  меняется только если прежней нет в новом маршруте. */
export const taskTypeChangedPayloadSchema = taskEventBaseSchema.extend({
  title: z.string(),
  typeId: z.uuid(),
  typeName: z.string(),
  fromTypeId: z.uuid(),
  workflowId: z.uuid(),
  stageId: z.uuid(),
  stageName: z.string(),
});
export type TaskTypeChangedPayload = z.infer<typeof taskTypeChangedPayloadSchema>;
