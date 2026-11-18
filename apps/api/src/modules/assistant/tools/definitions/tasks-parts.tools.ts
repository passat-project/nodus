import { z } from 'zod';
import type { Paginated, TaskRelation, WorkflowAction } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asArray, asRecord, asTyped, pageItems, str } from '../projections.js';
import { tasksPartsMeta } from './meta/tasks-parts.meta.js';

/**
 * Чтение частей задачи (#928): связи и кнопки действий маршрута. Нужны,
 * чтобы модель получила id аргументов до записи (`tasks.add_relation`,
 * `tasks.press_action`), а не выдумывала их.
 */

export const RELATION_LABEL: Record<string, string> = {
  relates: 'связана',
  blocks: 'блокирует',
  precedes: 'предшествует',
  duplicates: 'дублирует',
};

export const tasksRelationsTool = defineTool({
  ...tasksPartsMeta['tasks.relations'],
  id: 'tasks.relations',
  title: 'Задачи: связи',
  description:
    'Связи задачи: с какими задачами связана, блокирует/предшествует/дублирует и направление связи. Отдаёт id задачи, номер и название — для tasks.get и tasks.add_relation.',
  keywords: ['связи задачи', 'связанные задачи', 'блокирует', 'зависимости', 'relations'],
  module: 'tasks',
  kind: 'read',
  featureFlag: 'tasks',
  hot: false,
  input: z.object({ id: z.uuid(), limit: z.number().int().min(1).max(50).default(20) }),
  api: { method: 'GET', path: '/tasks/:id/relations' },
  build: (input) => ({ path: `/tasks/${input.id}/relations` }),
  project: (data: Paginated<TaskRelation>) => {
    const rows = pageItems<TaskRelation>(data).map((relation) => {
      const task = relation.task;
      return `${RELATION_LABEL[relation.kind] ?? relation.kind}: №${task.number} «${task.title}» (id ${task.id})`;
    });
    return {
      text: rows.length > 0 ? `Связи задачи: ${rows.length}\n${rows.join('\n')}` : 'Связей нет.',
    };
  },
});

export const tasksActionsTool = defineTool({
  ...tasksPartsMeta['tasks.actions'],
  id: 'tasks.actions',
  title: 'Задачи: действия маршрута',
  description:
    'Кнопки действий маршрута задачи без смены статуса (например «Согласовать», «Приложить акт») с id и окном ввода. Вызывай перед tasks.press_action.',
  keywords: ['действия задачи', 'кнопки маршрута', 'нажать действие', 'actions'],
  module: 'tasks',
  kind: 'read',
  featureFlag: 'tasks',
  hot: false,
  input: z.object({ id: z.uuid() }),
  api: { method: 'GET', path: '/tasks/:id/actions' },
  build: (input) => ({ path: `/tasks/${input.id}/actions` }),
  project: (data: unknown) => {
    const actions = asArray(data)
      .map((raw) => asTyped<WorkflowAction>(raw))
      .filter((action): action is WorkflowAction => action !== null);
    if (actions.length === 0) return { text: 'Доступных действий маршрута нет.' };
    const rows = actions.map((action) => {
      const blocked = action.blockedBy.length > 0;
      const form = action.form ? ' · есть окно ввода' : '';
      return `${action.name} (id ${action.id})${blocked ? ' — ЗАБЛОКИРОВАНО' : ''}${form}`;
    });
    return { text: [`Действия маршрута: ${rows.length}`, ...rows].join('\n') };
  },
});

/** Короткая подпись действия для карточки (имя из портала, не слова модели). */
export async function actionName(
  ctx: { read?: (path: string) => Promise<unknown> },
  taskId: string,
  actionId: string,
): Promise<string | null> {
  try {
    const raw = await ctx.read?.(`/tasks/${taskId}/actions`);
    const found = asArray(raw)
      .map((item) => asRecord(item))
      .find((item) => str(item?.id) === actionId);
    return str(found?.name) ?? null;
  } catch {
    return null;
  }
}
export const tasksPartsReadTools = [tasksRelationsTool, tasksActionsTool];
