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
import { field, fieldsOf, shortId } from './write-cards.js';

/**
 * Переходы задач (#920): чтение доступных переходов и выполнение по id.
 * Симметрия с письмами: у задач уже был маршрут
 * `POST /tasks/:id/transitions/:transitionId`, но каталог отдавал только
 * `stageId` — модель гадала стадию. Теперь «заверши задачу» идёт через
 * доступный переход (гейты, окно, целевая стадия), запись — карточкой
 * подтверждения (ADR-0048).
 */

export const tasksTransitionsTool = defineTool({
  id: 'tasks.transitions',
  title: 'Задачи: доступные переходы',
  description:
    'Доступные переходы задачи: id перехода, название, целевая стадия, ограничения и поля окна. Всегда вызывай перед tasks.transition: id перехода не угадывается, а берётся отсюда.',
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
      const blocked = asArray(transition.blockedBy).length > 0;
      const form = asRecord(transition.form);
      const sections = asArray(form?.sections)
        .map((section) => str(asRecord(section)?.title) ?? str(asRecord(section)?.kind))
        .filter((title): title is string => Boolean(title));
      return [
        `«${transition.name}» → стадия «${transition.toStageName ?? '—'}» (id ${transition.id})`,
        blocked ? 'ЕСТЬ ОГРАНИЧЕНИЯ' : null,
        form?.enabled ? `окно ввода: ${sections.join(', ') || 'поля формы'}` : null,
        transition.toStageOutcome ? 'завершает задачу' : null,
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

const transitionInput = z.object({
  id: z.uuid(),
  transitionId: z.uuid(),
  /** Комментарий перехода — если окно перехода его требует/принимает. */
  comment: z.string().trim().max(2_000).optional(),
});

export const tasksTransitionTool = defineTool({
  id: 'tasks.transition',
  title: 'Задачи: выполнить переход',
  description:
    'Выполнить доступный переход задачи по id (из tasks.transitions): смена стадии по маршруту типа. Действие появится карточкой подтверждения; права и ограничения перехода проверяет API.',
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
  build: (input) => ({
    method: 'POST',
    path: `/tasks/${input.id}/transitions/${input.transitionId}`,
    body: input.comment ? { form: { comment: input.comment } } : {},
  }),
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
      return fieldsOf([
        field(
          'Задача',
          task ? `${task.number ? `№${task.number} ` : ''}«${task.title}»` : input.id,
        ),
        field('Переход', transition?.name),
        field('Новая стадия', transition?.toStageName),
        field('Комментарий', input.comment ? clip(input.comment, 400) : null),
        field('Ограничения', transition?.blocked),
      ]);
    },
    consequences:
      'Стадия задачи изменится сразу и станет видна участникам; обратной отмены нет — вернуть задачу можно только отдельным переходом маршрута.',
  },
});

interface TransitionInfo {
  name: string;
  toStageName: string | null;
  blocked: string | null;
}

/** Переход из живого каталога: название, стадия и человеческие ограничения. */
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
      const blocked = asArray(transition?.blockedBy)
        .map((reason) => str(asRecord(reason)?.kind))
        .filter((kind): kind is string => Boolean(kind));
      return {
        name: str(transition?.name) ?? 'Переход',
        toStageName: str(transition?.toStageName),
        blocked: blocked.length > 0 ? `есть ограничения: ${blocked.join(', ')}` : null,
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
