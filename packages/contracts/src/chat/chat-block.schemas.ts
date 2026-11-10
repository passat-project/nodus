import { z } from 'zod';

import { stageColorSchema } from '../workflows/workflow-primitives.schemas.js';

/**
 * Виды сообщений и блоки ленты (#380): `text` — обычное; `task_transition` —
 * блок перехода задачи (причина/итог окна); `letter_transition` — блок
 * перехода письма (#55, Р10: «Закрыть без регистрации», «Отменить
 * регистрацию» с причиной); `task_action` — нажатие действия без смены
 * статуса (#633). Реестр блоков — закрытый union по виду; #313 добавит
 * `system` без переделки. Вынесено из chat.schemas.ts (I5: файл агрегата
 * перерос 300 строк).
 */

export const chatMessageKindSchema = z.enum([
  'text',
  'task_transition',
  'letter_transition',
  'task_action',
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

/** Блок действия задачи (#633): нажата кнопка без смены статуса. Данные из
 *  payload события `task.action_pressed`; текст — комментарий окна. Статус
 *  не меняется, поэтому в строке только название действия и статус, в
 *  котором нажали. */
export const taskActionBlockSchema = z.object({
  kind: z.literal('task_action'),
  taskId: z.uuid(),
  recordId: z.uuid(),
  actionName: z.string().min(1).max(40),
  stageName: z.string().min(1).max(40),
  commentLabel: z.string().max(60).nullable(),
  result: z
    .object({
      fileCount: z.number().int().min(0),
      messageCount: z.number().int().min(0),
    })
    .nullable(),
});
export type TaskActionBlock = z.infer<typeof taskActionBlockSchema>;

/** Реестр блоков — закрытый union по виду (#313: + system). */
export const chatMessageBlockSchema = z.discriminatedUnion('kind', [
  taskTransitionBlockSchema,
  letterTransitionBlockSchema,
  taskActionBlockSchema,
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
