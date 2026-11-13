import { z } from 'zod';

import { stageColorSchema } from '../workflows/workflow-primitives.schemas.js';

/**
 * Виды сообщений и блоки ленты (#380): `text` — обычное; `task_transition` —
 * блок перехода задачи (причина/итог окна); `letter_transition` — блок
 * перехода письма (#55, Р10: «Закрыть без регистрации», «Отменить
 * регистрацию» с причиной). Реестр блоков — закрытый union по виду; #313
 * добавит `system` без переделки. Вынесено из chat.schemas.ts (I5: файл
 * агрегата перерос 300 строк).
 */

export const chatMessageKindSchema = z.enum([
  'text',
  'task_transition',
  'task_press',
  'letter_transition',
]);
export type ChatMessageKind = z.infer<typeof chatMessageKindSchema>;

/** Блок перехода задачи в ленте (#380): данные из payload события
 *  `task.stage_changed`; текст сообщения — причина (поиск/цитаты/превью
 *  уведомлений работают по `text`). */
export const taskTransitionBlockSchema = z.object({
  kind: z.literal('task_transition'),
  taskId: z.uuid(),
  recordId: z.uuid(),
  transitionName: z.string().min(1).max(32),
  fromStageName: z.string().min(1).max(40),
  toStageName: z.string().min(1).max(40),
  commentLabel: z.string().max(60).nullable(),
  result: z
    .object({
      fileCount: z.number().int().min(0),
      messageCount: z.number().int().min(0),
    })
    .nullable(),
});
export type TaskTransitionBlock = z.infer<typeof taskTransitionBlockSchema>;

/** Блок отметки сбора в ленте (#434): участник сдал результат или
 *  ответственный вернул его на доработку. Пишется только для адресных
 *  раундов; «Все сотрудники» блоков не создаёт (анти-спам). */
export const taskPressBlockSchema = z.object({
  kind: z.literal('task_press'),
  taskId: z.uuid(),
  transitionName: z.string().min(1).max(32),
  state: z.enum(['pressed', 'returned']),
  fileCount: z.number().int().min(0).nullable(),
  /** Сколько сотрудников возвращено одной операцией (state='returned'). */
  returnCount: z.number().int().min(0).nullable(),
});
export type TaskPressBlock = z.infer<typeof taskPressBlockSchema>;

/** Блок перехода письма (#55, Р10): из payload `correspondence.letter_stage_changed`
 *  (запись журнала `recordId`); текст сообщения — причина. Цвет цели — чип
 *  стадии, как в карточке письма. */
export const letterTransitionBlockSchema = z.object({
  kind: z.literal('letter_transition'),
  letterId: z.uuid(),
  recordId: z.uuid(),
  transitionName: z.string().min(1).max(32),
  fromStageName: z.string().min(1).max(40),
  toStageName: z.string().min(1).max(40),
  toStageColor: stageColorSchema,
  commentLabel: z.string().max(60).nullable(),
});
export type LetterTransitionBlock = z.infer<typeof letterTransitionBlockSchema>;

/** Реестр блоков — закрытый union по виду (#313: + system). */
export const chatMessageBlockSchema = z.discriminatedUnion('kind', [
  taskTransitionBlockSchema,
  taskPressBlockSchema,
  letterTransitionBlockSchema,
]);
export type ChatMessageBlock = z.infer<typeof chatMessageBlockSchema>;

/** Поиск сообщений по id (окно перехода: файлы/сообщения итога бывают вне
 *  загруженной ленты): `ids=uuid,uuid` — 1..50 уникальных. */
export const lookupMessagesQuerySchema = z.object({
  ids: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .transform((raw) => raw.split(','))
    .pipe(
      z
        .array(z.uuid())
        .min(1)
        .max(50)
        .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate ids' }),
    ),
});
export type LookupMessagesQuery = z.infer<typeof lookupMessagesQuerySchema>;
