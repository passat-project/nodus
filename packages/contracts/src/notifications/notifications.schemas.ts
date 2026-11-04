import { z } from 'zod';

import { userRefSchema } from '../directory/user-ref.schema.js';
import { cursorQuerySchema } from '../pagination/paginated.schema.js';

/**
 * Контракты модуля notifications (#100, ADR-0016; приоритеты — #189/ADR-0017):
 * журнал уведомлений — источник истины; абстрактные приоритеты
 * urgent/high/medium/low, маппинг kind → priority — декларативная таблица
 * на бэке; ознакомление (ack) только для срочных. Русские строки UI — по
 * `kind` из i18n (I15), сервер лингвистики не несёт.
 */

/** Приоритет уведомления: абстрактная шкала важности, независимая от смысла
 *  события (ось kind); иерархия блоков Главной = иерархия приоритетов. */
export const notificationPrioritySchema = z.enum(['urgent', 'high', 'medium', 'low']);
export type NotificationPriority = z.infer<typeof notificationPrioritySchema>;

/**
 * Тип источника уведомления. kind — механика «что случилось» (заголовок
 * строки из i18n), sourceType/sourceId — «где» (переход по клику).
 * `urgent.message`/`chat.*` — живые источники; `action.*` — заделы под
 * поручения/согласования (бэк-источники появятся с модулями).
 */
export const notificationKindSchema = z.enum([
  'urgent.message',
  'chat.direct_message',
  'chat.mention',
  'chat.thread_reply',
  'chat.channel_post',
  'chat.message_edited',
  'action.assignment',
  'action.approval',
  'action.deadline',
  /** Задача выполнена без утверждения (из работы сразу в «Итог») —
   *  постановщику (#37). */
  'task.completed',
  /** Задача возвращена в работу — ответственному (#37). */
  'task.returned',
  /** Задача вошла в этап «Утверждение» — постановщику (#378). */
  'task.awaiting_approval',
  /** Задача отменена (итог «отменена») — исполнителю и соисполнителям (#378). */
  'task.cancelled',
  /** Работа отклонена утверждающим (итог «отклонена») — автору и
   *  исполнителю (#430, ADR-0025 п.1). */
  'task.rejected',
  /** Работа принята: «Утверждение» → «Итог» с исходом «выполнена» —
   *  исполнителю (ADR-0020, дополнение 2). */
  'task.approved',
  /** Письмо принято из общего ящика — держателям `correspondence.register`
   *  (#56, В4: Вике нужно реагировать быстро). */
  'letter.arrived',
  /** Общий ящик не читается после нескольких неудачных попыток (#56, В4). */
  'mail.sync_failed',
  /** Исходящее письмо не отправлено (#56, Р7 → #464). */
  'letter.send_failed',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationSourceSchema = z.enum([
  'conversation',
  'message',
  'task',
  'letter',
  'workflow',
  /** Ящик приёма почты (#56): клика нет — источник «почта молчит». */
  'mail',
]);
export type NotificationSource = z.infer<typeof notificationSourceSchema>;

/** Прочитать все уведомления сущности (открыта карточка задачи, #252). */
export const readNotificationsBySourceBodySchema = z.object({
  sourceType: z.enum(['task', 'letter']),
  sourceId: z.uuid(),
});
export type ReadNotificationsBySourceBody = z.infer<typeof readNotificationsBySourceBodySchema>;

/** Строка журнала уведомлений (единая выдача ленты Главной, колокольчика и дельты). */
export const notificationSchema = z.object({
  id: z.uuid(),
  /** Глобальный порядок журнала (bigserial): курсор дельты после reconnect. */
  seq: z.number().int().positive(),
  priority: notificationPrioritySchema,
  kind: notificationKindSchema,
  sourceType: notificationSourceSchema,
  sourceId: z.uuid(),
  /** Кто породил (автор сообщения); null — системное. */
  actor: userRefSchema.nullable(),
  /** Превью текста (выжимка «что»); null — без текста. */
  preview: z.string().nullable(),
  /** Полный текст важного — тело «листа ознакомления» (только urgent). */
  urgentText: z.string().nullable(),
  conversationId: z.uuid().nullable(),
  /** Название беседы («где»); у direct — null, строка покажет автора. */
  conversationTitle: z.string().nullable(),
  messageId: z.uuid().nullable(),
  threadRootId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  /** Ознакомление (СЭД-паттерн): только urgent, отдельный от readAt акт. */
  ackAt: z.iso.datetime().nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** Сводка для индикации «число + точка» (колокольчик, рейка, document.title). */
export const notificationSummarySchema = z.object({
  /** Непрочитанные важные (urgent+high+medium) — ЧИСЛО. */
  attention: z.number().int().min(0),
  urgent: z.number().int().min(0),
  high: z.number().int().min(0),
  medium: z.number().int().min(0),
  /** Непрочитанный низкий — ТОЧКА без числа (cap отображения «999+» — клиент). */
  low: z.number().int().min(0),
});
export type NotificationSummary = z.infer<typeof notificationSummarySchema>;

/** Фильтры ленты: пилюли Главной + низкий + «Все» (история журнала). */
export const notificationFilterSchema = z.enum(['attention', 'unread', 'mentions', 'low', 'all']);
export type NotificationFilter = z.infer<typeof notificationFilterSchema>;

export const listNotificationsQuerySchema = cursorQuerySchema.extend({
  filter: notificationFilterSchema.default('attention'),
  /** Подстрока по превью (поиск Главной). */
  q: z.string().trim().max(200).optional(),
  /** Дельта после reconnect: только записи журнала с seq > afterSeq. */
  afterSeq: z.number().int().nonnegative().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/** Ответ списка — канон `{ items, nextCursor }` (I7). */
export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  /** Курсор дельты (max seq страницы) — клиент хранит для afterSeq. */
  lastSeq: z.number().int().nonnegative(),
});
export type NotificationPage = z.infer<typeof notificationPageSchema>;

/** Политика дневного лимита важных (#177): счётчик зарядов молнии.
 *  Сутки скользящие (не календарные): resetAt = старейшая отправка отправителя
 *  за последние 24ч + 24ч; null — лимит не исчерпан, ожидания нет. */
export const urgentPolicySchema = z.object({
  remaining: z.number().int().min(0),
  limit: z.number().int().min(0),
  resetAt: z.iso.datetime().nullable(),
  /** Потолок участников для важных. */
  groupMax: z.number().int().min(0),
});
export type UrgentPolicy = z.infer<typeof urgentPolicySchema>;

/** Настройки уведомлений пользователя (DND-расписание; тосты гасятся, кроме urgent). */
export const notificationSettingsSchema = z.object({
  dndEnabled: z.boolean(),
  /** Начало/конец окна «не беспокоить», локальное «HH:mm». */
  dndStart: z.string().regex(/^\d{2}:\d{2}$/),
  dndEnd: z.string().regex(/^\d{2}:\d{2}$/),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const updateNotificationSettingsBodySchema = notificationSettingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });
export type UpdateNotificationSettingsBody = z.infer<typeof updateNotificationSettingsBodySchema>;

/** Запись журнала доставок одного уведомления (D6: когда и каким каналом). */
export const notificationDeliverySchema = z.object({
  channel: z.enum(['ws', 'repeat']),
  /** Попытка повтора (channel='repeat': 1..N); ws — 0. */
  attempt: z.number().int().min(0),
  deliveredAt: z.iso.datetime(),
});
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;
