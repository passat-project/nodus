import { z } from 'zod';

import { ASSISTANT_LIMITS } from './assistant-limits.js';

/**
 * Контракты ИИ-ассистента портала (эпик #889, ADR-0043): сессии, сообщения,
 * прогоны, события SSE и вызовы инструментов.
 *
 * Границы модели:
 * - Сессия принадлежит сотруднику; чужая — 404 (не раскрываем существование).
 * - Сообщение в БД: `role` — только `user`/`assistant` (tool-результаты живут
 *   в прогоне, а не в ленте диалога).
 * - Прогон — одна отправка: агентный цикл с инструментами до финального
 *   текста. События прогона имеют монотонный `seq` на прогон — по нему
 *   восстанавливается поток после переподключения (`Last-Event-ID`).
 */

/** Роль автора сообщения в ленте диалога. */
export const assistantRoleSchema = z.enum(['user', 'assistant']);
export type AssistantRole = z.infer<typeof assistantRoleSchema>;

/** Состояние прогона: `queued` — принят, `running` — идёт цикл. */
export const assistantRunStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type AssistantRunStatus = z.infer<typeof assistantRunStatusSchema>;

/** Терминальные состояния: поток закрыт, отмена/повтор уже не действуют. */
export const TERMINAL_RUN_STATUSES: readonly AssistantRunStatus[] = [
  'completed',
  'failed',
  'cancelled',
];

/** Состояние вызова инструмента в карточке ленты. */
export const assistantToolCallStatusSchema = z.enum(['running', 'done', 'error']);
export type AssistantToolCallStatus = z.infer<typeof assistantToolCallStatusSchema>;

/** Контекст экрана, который клиент прикладывает к сообщению. */
export const assistantContextSchema = z.object({
  /** Раздел портала (id из nav-registry): `tasks`, `letters`, `chat`, … */
  moduleId: z.string().max(40).nullable().optional(),
  /** Открытая карточка: тип и id — только для разрешённых видов. */
  cardKind: z.enum(['task', 'project', 'letter', 'conversation']).nullable().optional(),
  cardId: z.uuid().nullable().optional(),
});
export type AssistantContext = z.infer<typeof assistantContextSchema>;

/**
 * Вызов инструмента в ленте: то, что видит сотрудник в карточке хода.
 * Полные аргументы — для прозрачности (сворачиваемые детали); результат —
 * краткий фрагмент, а не сырой JSON (ADR-0043: компактные проекции).
 */
export const assistantToolCallSchema = z.object({
  id: z.uuid(),
  toolId: z.string().min(1),
  /** Человеческое название действия («Задачи: список»). */
  title: z.string().min(1),
  status: assistantToolCallStatusSchema,
  /** Аргументы вызова (после валидации zod-схемой инструмента). */
  args: z.record(z.string(), z.unknown()).nullable(),
  /** Краткий результат для карточки (обрезан по лимиту). */
  resultPreview: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** Код ошибки API портала, если вызов не удался. */
  errorCode: z.string().nullable(),
  /** Ссылка «Открыть» (`ui.open_entity`) — только внутренние пути портала. */
  href: z.string().nullable(),
  hrefLabel: z.string().nullable(),
});
export type AssistantToolCall = z.infer<typeof assistantToolCallSchema>;

/** Сообщение ленты диалога. */
export const assistantMessageSchema = z.object({
  id: z.uuid(),
  role: assistantRoleSchema,
  text: z.string(),
  createdAt: z.iso.datetime(),
  /** Прогон, породивший сообщение ассистента (для «Повторить»/SSE). */
  runId: z.uuid().nullable(),
  /** Ответ допечатывается или оборван: лента рисует курсор/пометку. */
  streaming: z.boolean(),
  /** Код ошибки прогона, если ответ не состоялся (UI переводит по коду). */
  errorCode: z.string().nullable(),
  toolCalls: z.array(assistantToolCallSchema),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

/** Сессия диалога (заголовок — первый вопрос, как в чатах). */
export const assistantSessionSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  archived: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime().nullable(),
  messageCount: z.number().int().nonnegative(),
});
export type AssistantSession = z.infer<typeof assistantSessionSchema>;

export const assistantSessionListSchema = z.object({
  items: z.array(assistantSessionSchema),
  nextCursor: z.string().min(1).nullable(),
});

export const assistantMessageListSchema = z.object({
  items: z.array(assistantMessageSchema),
  nextCursor: z.string().min(1).nullable(),
});

export const createAssistantSessionBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
});
export type CreateAssistantSessionBody = z.infer<typeof createAssistantSessionBodySchema>;

export const updateAssistantSessionBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => value.title !== undefined || value.archived !== undefined, {
    message: 'Нужно хотя бы одно поле: title или archived',
  });
export type UpdateAssistantSessionBody = z.infer<typeof updateAssistantSessionBodySchema>;

export const sendAssistantMessageBodySchema = z.object({
  text: z.string().trim().min(1).max(ASSISTANT_LIMITS.maxPromptChars),
  context: assistantContextSchema.optional(),
});
export type SendAssistantMessageBody = z.infer<typeof sendAssistantMessageBodySchema>;

/** Ответ отправки (202): прогон и созданное сообщение сотрудника. */
export const sendAssistantMessageResponseSchema = z.object({
  runId: z.uuid(),
  messageId: z.uuid(),
});
export type SendAssistantMessageResponse = z.infer<typeof sendAssistantMessageResponseSchema>;

/** Статус прогона (fallback, если поток недоступен). */
export const assistantRunSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  status: assistantRunStatusSchema,
  model: z.string().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AssistantRun = z.infer<typeof assistantRunSchema>;

/**
 * События прогона (SSE). Имя события = `type`, `id` = `seq`. Данные
 * плоские и маленькие: клиент рисует дельты, карточки инструментов и финал
 * без дополнительных запросов.
 */
export const assistantRunEventTypeSchema = z.enum([
  'run.started',
  'message.delta',
  'tool.started',
  'tool.finished',
  'message.completed',
  'run.completed',
  'run.error',
  'run.cancelled',
]);
export type AssistantRunEventType = z.infer<typeof assistantRunEventTypeSchema>;

/** Данные события по типу (валидируются на клиенте при разборе потока). */
export const assistantRunEventDataSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('run.started'),
    messageId: z.uuid(),
    model: z.string().nullable(),
  }),
  z.object({ type: z.literal('message.delta'), text: z.string() }),
  z.object({
    type: z.literal('tool.started'),
    toolCallId: z.uuid(),
    toolId: z.string(),
    title: z.string(),
    args: z.record(z.string(), z.unknown()).nullable(),
  }),
  z.object({
    type: z.literal('tool.finished'),
    toolCallId: z.uuid(),
    toolId: z.string(),
    status: assistantToolCallStatusSchema,
    resultPreview: z.string().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    errorCode: z.string().nullable(),
    href: z.string().nullable(),
    hrefLabel: z.string().nullable(),
  }),
  z.object({ type: z.literal('message.completed'), messageId: z.uuid(), text: z.string() }),
  z.object({
    type: z.literal('run.completed'),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    type: z.literal('run.error'),
    code: z.string().min(1),
    message: z.string().min(1),
    /** Ошибка провайдера/лимит шагов: повтор осмыслен (кнопка «Повторить»). */
    retryable: z.boolean(),
  }),
  z.object({ type: z.literal('run.cancelled') }),
]);
export type AssistantRunEventData = z.infer<typeof assistantRunEventDataSchema>;

/** Событие с номером в прогоне (SSE `id`). */
export const assistantRunEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: assistantRunEventTypeSchema,
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type AssistantRunEvent = z.infer<typeof assistantRunEventSchema>;
