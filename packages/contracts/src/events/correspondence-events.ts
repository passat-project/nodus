import { z } from 'zod';

import { LETTER_LIMITS } from '../correspondence/letter-registration.schemas.js';
import {
  letterRelationActionSchema,
  letterRelationKindSchema,
  letterSourceSchema,
} from '../correspondence/letter.schemas.js';
import { letterDirectionSchema } from '../workflows/process-type.schemas.js';
import {
  stageOutcomeSchema,
  taskSystemStateSchema,
} from '../workflows/workflow-primitives.schemas.js';

/**
 * Каталог доменных событий модуля correspondence (#55, I9; каталог
 * api-conventions.md, только расширяется; префикс — модуль-владелец
 * `correspondence.*`). Payload минимальный: ссылки — id, подробности —
 * GET /letters/:id. Содержимое удалённого спама в события не попадает (Р12).
 */
export const CORRESPONDENCE_EVENTS = {
  /** Письмо поступило в «Новые» (вручную или почтой #56). */
  LETTER_RECEIVED: 'correspondence.letter_received',
  /** Зарегистрировано: номер присвоен (Р1). */
  LETTER_REGISTERED: 'correspondence.letter_registered',
  /** Смена стадии маршрута письма (кнопка движка; блок чата — Р10). */
  LETTER_STAGE_CHANGED: 'correspondence.letter_stage_changed',
  /** Закрыто без регистрации (стадия «Не зарегистрировано»). */
  LETTER_CLOSED_UNREGISTERED: 'correspondence.letter_closed_unregistered',
  /** Правка регистрационных данных (В3, Р11): история карточки. */
  LETTER_UPDATED: 'correspondence.letter_updated',
  /** Состав участников письма (присоединение, адресат) — мост чата. */
  LETTER_PARTICIPANTS_CHANGED: 'correspondence.letter_participants_changed',
  /** Связь писем поставлена/заменена/снята (#461, Р6): история карточки
   *  (`relation_changed`), будущий граф #453. Актор — в meta, не в payload. */
  LETTER_RELATIONS_CHANGED: 'correspondence.letter_relations_changed',
  /** Удалено как спам (Р12). */
  LETTER_DELETED: 'correspondence.letter_deleted',
  /** Почтовый ящик не читается после нескольких неудачных попыток
   *  (аккумулятор порога, #56, В4). */
  MAIL_SYNC_FAILED: 'correspondence.mail_sync_failed',
  /** Исходящее письмо не отправлено (финальный провал SMTP, #56 Р7 → #464). */
  LETTER_SEND_FAILED: 'correspondence.letter_send_failed',
  /** Зарезервировано: отправка исходящего (#464). */
  LETTER_SENT: 'correspondence.letter_sent',
} as const;

export type CorrespondenceEventType =
  (typeof CORRESPONDENCE_EVENTS)[keyof typeof CORRESPONDENCE_EVENTS];

export const letterReceivedPayloadSchema = z.object({
  letterId: z.uuid(),
  typeId: z.uuid(),
  direction: letterDirectionSchema,
  source: letterSourceSchema,
  /** Тема (null — без темы): превью уведомления «Поступило письмо» (#56). */
  subject: z.string().nullable(),
  /** Файлы письма — вход конвейера PDF-производных офисных документов.
   *  Почта приносит до `LETTER_LIMITS.mailFiles` вложений + тело + исходник
   *  (#56, Р12). */
  fileIds: z.array(z.uuid()).max(Math.max(LETTER_LIMITS.files, LETTER_LIMITS.mailFiles) + 2),
});
export type LetterReceivedPayload = z.infer<typeof letterReceivedPayloadSchema>;

export const letterRegisteredPayloadSchema = z.object({
  letterId: z.uuid(),
  typeId: z.uuid(),
  direction: letterDirectionSchema,
  regNumber: z.string().min(1),
  registeredAt: z.iso.datetime(),
  counterpartyId: z.uuid(),
  signerId: z.uuid().nullable(),
  addresseeId: z.uuid(),
  registrarId: z.uuid(),
  projectId: z.uuid().nullable(),
});
export type LetterRegisteredPayload = z.infer<typeof letterRegisteredPayloadSchema>;

/** Смена стадии (как `task.stage_changed`, #380): `recordId` — запись
 *  журнала переходов; причина и её подпись — для блока чата. */
export const letterStageChangedPayloadSchema = z.object({
  letterId: z.uuid(),
  fromStageId: z.uuid(),
  toStageId: z.uuid(),
  toStageName: z.string().min(1),
  fromState: taskSystemStateSchema,
  toState: taskSystemStateSchema,
  toStageOutcome: stageOutcomeSchema.nullable(),
  transitionId: z.uuid().nullable(),
  cause: z.enum(['transition', 'migration']),
  recordId: z.uuid().optional(),
  transitionName: z.string().optional(),
  fromStageName: z.string().optional(),
  comment: z.string().optional(),
  commentLabel: z.string().optional(),
});
export type LetterStageChangedPayload = z.infer<typeof letterStageChangedPayloadSchema>;

export const letterClosedUnregisteredPayloadSchema = z.object({ letterId: z.uuid() });
export type LetterClosedUnregisteredPayload = z.infer<typeof letterClosedUnregisteredPayloadSchema>;

/** Правка данных (Р11): изменения — ключи и id (подписи гидрирует история
 *  через порты); `counterpartyId`/`signerId` — новые значения для проекции
 *  использования контрагента и контакта (CRM). */
export const letterUpdatedPayloadSchema = z.object({
  letterId: z.uuid(),
  changes: z
    .array(
      z.object({
        field: z.string().min(1).max(64),
        from: z.unknown(),
        to: z.unknown(),
      }),
    )
    .min(1)
    .max(LETTER_LIMITS.changes),
  counterpartyId: z.uuid().optional(),
  signerId: z.uuid().nullable().optional(),
});
export type LetterUpdatedPayload = z.infer<typeof letterUpdatedPayloadSchema>;

export const letterParticipantsChangedPayloadSchema = z.object({
  letterId: z.uuid(),
  added: z.array(z.uuid()),
  removed: z.array(z.uuid()),
});
export type LetterParticipantsChangedPayload = z.infer<
  typeof letterParticipantsChangedPayloadSchema
>;

/** Связь писем (#461, Р6): вид, вторая сторона и действие; подробности
 *  (номера, темы) читаются GET /letters/:id/tree. */
export const letterRelationsChangedPayloadSchema = z.object({
  letterId: z.uuid(),
  relatedLetterId: z.uuid(),
  kind: letterRelationKindSchema,
  action: letterRelationActionSchema,
});
export type LetterRelationsChangedPayload = z.infer<typeof letterRelationsChangedPayloadSchema>;

export const letterDeletedPayloadSchema = z.object({ letterId: z.uuid() });
export type LetterDeletedPayload = z.infer<typeof letterDeletedPayloadSchema>;

/** Ящик не читается: аккумулятор циклов дошёл до порога (#56, Р4/В4).
 *  `sourceId`/`sourceCode` — строка mail_sources ('chancery'), error —
 *  человекочитаемая причина последней неудачи. */
export const mailSyncFailedPayloadSchema = z.object({
  sourceId: z.uuid(),
  sourceCode: z.string().min(1),
  error: z.string().min(1),
  attempts: z.number().int().min(1),
});
export type MailSyncFailedPayload = z.infer<typeof mailSyncFailedPayloadSchema>;

/** Исходящее не отправлено после всех повторов (SMTP 5xx/лимит, #56, Р7).
 *  `letterId` null — отправка вне карточки письма (транспорт для #464). */
export const letterSendFailedPayloadSchema = z.object({
  letterId: z.uuid().nullable(),
  error: z.string().min(1),
});
export type LetterSendFailedPayload = z.infer<typeof letterSendFailedPayloadSchema>;
