import { z } from 'zod';
import type { ExecuteTransitionResult, WorkflowTransition } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import {
  asArray,
  asRecord,
  asTyped,
  clip,
  entityLink,
  finalize,
  listBlock,
  num,
  str,
} from '../projections.js';
import {
  OUTCOME_LABELS,
  blockedSummary,
  formRequirements,
  gateLabel,
} from './transition-projection.js';
import { field, fieldsOf, shortId } from './write-cards.js';

/**
 * Переходы задач (#920): чтение доступных переходов и выполнение по id.
 * Симметрия с письмами: у задач уже был маршрут
 * `POST /tasks/:id/transitions/:transitionId`, но каталог отдавал только
 * `stageId` — модель гадала стадию. Теперь «заверши задачу» идёт через
 * доступный переход (гейты, окно ввода, целевая стадия), запись — карточкой
 * подтверждения (ADR-0048).
 *
 * Окно перехода (#380): `tasks.transitions` отдаёт требования человеческими
 * подписями (какие поля, обязателен ли комментарий, нужны ли итог/время);
 * `tasks.transition` принимает эти поля телом `form` — сервер повторно
 * валидирует состав окна (лишнее/пропущенное обязательное → 422).
 */

export const tasksTransitionsTool = defineTool({
  id: 'tasks.transitions',
  title: 'Задачи: доступные переходы',
  description:
    'Доступные переходы задачи: id перехода, название, целевая стадия, ограничения и требования окна (какие поля/комментарий/итог нужны). Всегда вызывай перед tasks.transition: id перехода не угадывается, а берётся отсюда.',
  keywords: [
    'переходы',
    'сменить статус',
    'завершить задачу',
    'вернуть задачу',
    'кнопки статуса',
    'transitions',
  ],
  module: 'tasks',
  kind: 'read',
  featureFlag: 'tasks',
  hot: true,
  input: z.object({ id: z.uuid() }),
  api: { method: 'GET', path: '/tasks/:id/transitions' },
  build: (input) => ({ path: `/tasks/${input.id}/transitions` }),
  project: (data: WorkflowTransition[], input) => {
    const rows = asArray(data).map((raw) => {
      const transition = asTyped<WorkflowTransition>(raw);
      if (!transition?.id || !transition.name) return null;
      const blocked = blockedSummary(transition);
      const requirements = formRequirements(transition.form);
      return [
        `«${transition.name}» → стадия «${transition.toStageName ?? '—'}» (id ${transition.id})`,
        requirements ? `окно: ${requirements}` : null,
        blocked,
        transition.toStageOutcome
          ? (OUTCOME_LABELS[transition.toStageOutcome] ?? 'завершает задачу')
          : null,
      ]
        .filter(Boolean)
        .join(', ');
    });
    const text = finalize(
      listBlock(
        'Доступные переходы задачи',
        rows.filter((row): row is string => row !== null),
        { maxRows: 20 },
      ),
    );
    return {
      text:
        rows.length === 0
          ? 'Доступных переходов нет: у вас нет прав на переходы этой задачи или маршрут её типа не настроен'
          : text,
      entity: entityLink('task', input.id, 'Задача'),
    };
  },
});

const transitionFormInput = z.object({
  /** Комментарий перехода (раздел «Комментарий»). */
  comment: z.string().trim().min(1).max(2_000).optional(),
  /** Итог задачи (раздел «Итог»): текст и id сообщений-вложений. */
  result: z
    .object({
      text: z.string().trim().max(5_000),
      messageIds: z.array(z.uuid()).max(50).default([]),
    })
    .optional(),
  /** Трудозатраты (раздел «Время»). */
  time: z
    .object({
      minutes: z.number().int().min(1).max(1_440),
      date: z.iso.date(),
      comment: z.string().trim().max(500).optional(),
    })
    .optional(),
  /** Поля карточки (раздел «Поля»): системные и атрибуты `cf.<id>`. */
  fields: z
    .object({
      description: z.string().trim().min(1).max(5_000).optional(),
      deadline: z.iso.datetime().optional(),
      assigneeId: z.uuid().optional(),
      plannedMinutes: z.number().int().min(1).max(100_000).optional(),
      customFields: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
        .optional(),
    })
    .optional(),
});

const transitionInput = z.object({
  id: z.uuid(),
  transitionId: z.uuid(),
  /** Поля окна перехода: сервер валидирует состав (422 при расхождении). */
  form: transitionFormInput.optional(),
  /** Короткая форма комментария (совместимость): уходит в `form.comment`. */
  comment: z.string().trim().max(2_000).optional(),
  /** Обход гейта: только если `tasks.transitions` сказал «можно обойти». */
  override: z.boolean().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const tasksTransitionTool = defineTool({
  id: 'tasks.transition',
  title: 'Задачи: выполнить переход',
  description:
    'Выполнить доступный переход задачи по id (из tasks.transitions): смена стадии по маршруту типа. Обязательные поля окна передавай в form (comment, result.text, time, fields) — сервер валидирует. Действие появится карточкой подтверждения; права и ограничения проверяет API.',
  keywords: [
    'завершить задачу',
    'закрыть задачу',
    'сменить статус',
    'перевести задачу',
    'переход',
    'transition',
  ],
  module: 'tasks',
  kind: 'write',
  featureFlag: 'tasks',
  hot: true,
  input: transitionInput,
  api: { method: 'POST', path: '/tasks/:id/transitions/:transitionId' },
  build: (input) => {
    const form = formBody(input.form, input.comment);
    return {
      method: 'POST',
      path: `/tasks/${input.id}/transitions/${input.transitionId}`,
      body: {
        ...(form ? { form } : {}),
        ...(input.override === true ? { override: true } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      },
    };
  },
  project: (data: ExecuteTransitionResult, input) => {
    const task = asTyped<ExecuteTransitionResult['task']>(asRecord(data)?.task);
    const id = task?.id ?? input.id;
    const stage = task?.stage?.name;
    const title = task?.title ?? 'задача';
    const number = task?.number;
    return {
      text: `Переход выполнен: задача ${number ? `№${number} ` : ''}«${title}»${stage ? ` теперь в стадии «${stage}»` : ''}, id ${id}`,
      entity: {
        href: `?cards=task:${id}`,
        label: `${number ? `№${number} ` : ''}${title}`.trim(),
      },
    };
  },
  card: {
    title: 'Выполнить переход задачи',
    summary: async (input, ctx) => {
      const task = await readTask(ctx, input.id);
      const transition = await readTransition(ctx, input.id, input.transitionId);
      const label = task
        ? `${task.number ? `№${task.number} ` : ''}«${task.title}»`
        : `id ${shortId(input.id)}`;
      return `Переход${transition ? ` «${transition.name}»` : ''} задачи ${label}`;
    },
    fields: async (input, ctx) => {
      const [task, transition] = await Promise.all([
        readTask(ctx, input.id),
        readTransition(ctx, input.id, input.transitionId),
      ]);
      const form = input.form;
      const comment = form?.comment ?? input.comment;
      const time = form?.time;
      return fieldsOf([
        field(
          'Задача',
          task ? `${task.number ? `№${task.number} ` : ''}«${task.title}»` : input.id,
        ),
        field('Переход', transition?.name),
        field('Новая стадия', transition?.toStageName),
        field('Требует заполнить', transition?.requirements),
        field('Итог', form?.result?.text ? clip(form.result.text, 400) : null),
        field(
          'Трудозатраты',
          time
            ? `${time.minutes} мин, ${time.date}${time.comment ? `, ${time.comment}` : ''}`
            : null,
        ),
        field('Комментарий', comment ? clip(comment, 400) : null),
        field('Обход гейта', input.reason ? clip(input.reason, 300) : null),
        field('Ограничения', transition?.blocked),
      ]);
    },
    consequences:
      'Стадия задачи изменится сразу и станет видна участникам; обратной отмены нет — вернуть задачу можно только отдельным переходом маршрута.',
  },
});

/** Тело `form` без пустых ключей; короткий `comment` уходит в него же. */
function formBody(
  form: z.infer<typeof transitionFormInput> | undefined,
  comment: string | undefined,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = { ...(form ?? {}) };
  if (!body.comment && comment) body.comment = comment;
  return Object.keys(body).length > 0 ? body : null;
}

interface TransitionInfo {
  name: string;
  toStageName: string | null;
  blocked: string | null;
  requirements: string | null;
}

/** Переход из живого каталога: название, стадия, ограничения и окно. */
async function readTransition(
  ctx: ToolContext,
  taskId: string,
  transitionId: string,
): Promise<TransitionInfo | null> {
  try {
    const rows = asArray(await ctx.read?.(`/tasks/${taskId}/transitions`));
    for (const raw of rows) {
      const transition = asRecord(raw);
      if (str(transition?.id) !== transitionId) continue;
      const typed = asTyped<WorkflowTransition>(transition);
      const reasons = asArray(transition?.blockedBy)
        .map((reason) => gateLabel(reason))
        .filter((label): label is string => label !== null);
      return {
        name: str(transition?.name) ?? 'Переход',
        toStageName: str(transition?.toStageName),
        blocked:
          reasons.length > 0
            ? `есть ограничения: ${reasons.join('; ')}${typed?.canOverride ? ' (можно обойти с причиной)' : ''}`
            : null,
        requirements: formRequirements(transition?.form),
      };
    }
  } catch {
    return null;
  }
  return null;
}

/** Реальные номер и название задачи — карточка не повторяет слова модели. */
async function readTask(
  ctx: ToolContext,
  id: string,
): Promise<{ title: string; number: number | null } | null> {
  try {
    const raw = asRecord(await ctx.read?.(`/tasks/${id}`));
    const title = str(raw?.title);
    return title ? { title, number: num(raw?.number) } : null;
  } catch {
    return null;
  }
}

export const tasksTransitionTools = [tasksTransitionsTool, tasksTransitionTool];
