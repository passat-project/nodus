import { z } from 'zod';

import { customFieldKeySchema } from '../custom-fields/custom-field-key.js';
import { transitionFormInputSchema, type TransitionFormInput } from './transition-form.schemas.js';
import { workflowActorRoleSchema } from './workflow-roles.js';

/**
 * «Кнопку жмут несколько» (#434, ADR-0025 п.5): настройка сбора результатов
 * живёт на КНОПКЕ обычного маршрута. Кнопка остаётся обычным переходом:
 * пока кворум не собран, нажатие записывает результат участника; после
 * последнего — переход выполняется один раз. Отдельного статуса/маршрута нет.
 */

/** Вид должности — та же пара, что у оргструктуры. */
export const pressPositionKindSchema = z.enum(['management', 'legal']);
export type PressPositionKind = z.infer<typeof pressPositionKindSchema>;

export const pressSourceSchema = z.discriminatedUnion('kind', [
  /** Соисполнители задачи (у письма — исполнители, если адаптер поддержит). */
  z.object({ kind: z.literal('coexecutors') }),
  /** Ответственный и все соисполнители. */
  z.object({ kind: z.literal('assignee_and_coexecutors') }),
  /** Роль в сущности категории: например, «соисполнитель» или «адресат». */
  z.object({ kind: z.literal('role'), roles: z.array(workflowActorRoleSchema).min(1) }),
  /** Держатели должности: несколько — любой. */
  z.object({
    kind: z.literal('position'),
    positionId: z.uuid(),
    positionKind: pressPositionKindSchema,
  }),
  /** Конкретные сотрудники. */
  z.object({ kind: z.literal('employees'), userIds: z.array(z.uuid()).min(1).max(50) }),
  /** Поле «Сотрудник»/«Сотрудники» (`cf.<uuid>`). */
  z.object({ kind: z.literal('field'), field: customFieldKeySchema }),
  /** Все активные сотрудники компании — снимок на старте сбора. */
  z.object({ kind: z.literal('all_employees') }),
  /** Получатели письма — источник категории `letter` (ADR-0025 п.5). */
  z.object({ kind: z.literal('letter_recipients') }),
]);
export type PressSource = z.infer<typeof pressSourceSchema>;

export const pressQuorumSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('any') }),
  z.object({ kind: z.literal('count'), count: z.number().int().min(1).max(100) }),
]);
export type PressQuorum = z.infer<typeof pressQuorumSchema>;

/** Одновременно или по очереди (по порядку списка участников). */
export const pressOrderSchema = z.enum(['parallel', 'sequential']);
export type PressOrder = z.infer<typeof pressOrderSchema>;

/** Черновик настройки: пустые источники допустимы — их ловит публикация.
 *  Какие поля и блоки заполняет каждый участник, задаёт ОКНО КНОПКИ
 *  (`transition.form`, редактор «Редактировать окно», #496) — отдельной
 *  настройки разделов у сбора нет: окно одно на кнопку. */
export const pressConfigDraftSchema = z
  .object({
    sources: z.array(pressSourceSchema).max(10).default([]),
    quorum: pressQuorumSchema,
    order: pressOrderSchema.default('parallel'),
    /** Не учитывать автора (постановщика): он не утверждает своё. */
    excludeAuthor: z.boolean().default(true),
  })
  .strict();
export type PressConfigDraft = z.infer<typeof pressConfigDraftSchema>;

/** Настройка на границе публикации: источник обязателен. */
export const pressConfigSchema = pressConfigDraftSchema.extend({
  sources: z.array(pressSourceSchema).min(1).max(10),
});
export type PressConfig = z.infer<typeof pressConfigSchema>;

/** Состояние отметки участника. */
export const pressEntryStateSchema = z.enum([
  'waiting',
  'pressed',
  'returned',
  'excluded',
  'withdrawn',
]);
export type PressEntryState = z.infer<typeof pressEntryStateSchema>;

/** Результат участника (проекция его ввода в окне кнопки для аналитики):
 *  текст, закреплённые сообщения чата и время. Полный ввод — `TransitionFormInput`,
 *  он же тело сдачи; проекция не заменяет историю окна. */
export const pressEntryResultSchema = z.object({
  text: z.string(),
  messageIds: z.array(z.uuid()),
  fileCount: z.number().int().min(0),
  minutes: z.number().int().min(0).nullable(),
  date: z.iso.date().nullable(),
});
export type PressEntryResult = z.infer<typeof pressEntryResultSchema>;

/** Личные разделы отметки: что участник пишет «про своё» (#434). Поля
 *  карточки и регистрация в сбор не входят — их правит обычная кнопка/карточка. */
export const PRESS_WINDOW_SECTION_KINDS = [
  'time',
  'result',
  'result_files',
  'result_messages',
  'comment',
] as const;

/** Проекция ввода окна кнопки в строку «Статусы участников». */
export function pressEntryResultOf(form: TransitionFormInput): PressEntryResult {
  const messageIds = [...new Set(form.result?.messageIds ?? [])];
  return {
    text: form.result?.text.trim() || form.comment?.trim() || '',
    messageIds,
    fileCount: messageIds.length,
    minutes: form.time?.minutes ?? null,
    date: form.time?.date ?? null,
  };
}

export const pressEntryViewSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().min(1),
  order: z.number().int().min(0),
  state: pressEntryStateSchema,
  pressedAt: z.iso.datetime().nullable(),
  result: pressEntryResultSchema.nullable(),
  returnReason: z.string().nullable(),
});
export type PressEntryView = z.infer<typeof pressEntryViewSchema>;

/** Текущий раунд сбора в карточке: кнопка, прогресс, моя отметка и права. */
export const pressRoundViewSchema = z.object({
  id: z.uuid(),
  stageId: z.uuid(),
  /** Кнопка, которую жмут несколько. */
  transitionId: z.uuid(),
  transitionName: z.string().min(1).max(32),
  cycle: z.number().int().min(1),
  total: z.number().int().min(0),
  pressed: z.number().int().min(0),
  order: pressOrderSchema,
  quorum: pressQuorumSchema,
  entries: z.array(pressEntryViewSchema),
  myEntry: pressEntryViewSchema.nullable(),
  canSubmit: z.boolean(),
  canWithdraw: z.boolean(),
  /** Ответственный (или право правки задачи) может вернуть чужие отметки
   *  на доработку, пока раунд открыт: остальные остаются сданными. */
  canReturn: z.boolean(),
  completed: z.boolean(),
});
export type PressRoundView = z.infer<typeof pressRoundViewSchema>;

/** Сдача своей отметки: ввод окна кнопки целиком (поля, время, итог,
 *  комментарий) — окно и его разделы задаёт настройка кнопки. */
export const pressSubmitBodySchema = transitionFormInputSchema;
export type PressSubmitBody = z.infer<typeof pressSubmitBodySchema>;

/** Выборочный возврат: ответственный отмечает, чьи результаты переделать,
 *  и указывает причину; остальные отметки остаются сданными. */
export const pressReturnBodySchema = z
  .object({
    userIds: z.array(z.uuid()).min(1).max(500),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type PressReturnBody = z.infer<typeof pressReturnBodySchema>;
