import { z } from 'zod';

import { type ProjectDetail } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asRecord, str } from '../projections.js';
import { field, fieldsOf, projectLabel, shortId } from './write-cards.js';
import { projectsStructureWriteTools } from './projects-structure-write.tools.js';
import { projectsPartsMeta } from './meta/projects-parts.meta.js';

/**
 * Дневные действия проекта (#931): завершение/возврат, участие, портфель,
 * папки структуры. Без удаления, архивации, переноса проекта, ролей и формул —
 * это решения владельца, а не ассистента. Всё записывается карточкой (ADR-0048).
 */

const STATUS_LABEL: Record<string, string> = {
  active: 'в работе',
  completed: 'завершён',
  archived: 'в архиве',
};

function projectText(data: unknown, fallback: string): string {
  const project = asRecord(data);
  const id = str(project?.id);
  const name = str(project?.name);
  if (!id || !name) return fallback;
  const code = str(project?.code);
  return `${fallback}: ${code ? `${code} ` : ''}«${name}»`;
}

function projectEntity(data: unknown): { href: string; label: string } | undefined {
  const project = asRecord(data);
  const id = str(project?.id);
  if (!id) return undefined;
  return {
    href: `?cards=project:${id}`,
    label: str(project?.name) ?? 'Проект',
  };
}

export const projectsSetStatusTool = defineTool({
  ...projectsPartsMeta['projects.set_status'],
  id: 'projects.set_status',
  title: 'Проекты: завершить или вернуть в работу',
  description:
    'Сменить статус проекта: завершить или вернуть в работу. Архивация через ассистента недоступна. Действие появится карточкой подтверждения; право руководства проекта проверяет API.',
  keywords: ['завершить проект', 'закрыть проект', 'вернуть проект в работу', 'project status'],
  module: 'projects',
  kind: 'write',
  featureFlag: 'projects',
  hot: false,
  input: z.object({
    projectId: z.uuid(),
    status: z.enum(['active', 'completed']),
  }),
  api: { method: 'POST', path: '/projects/:id/status' },
  build: (input) => ({
    method: 'POST',
    path: `/projects/${input.projectId}/status`,
    body: { status: input.status },
  }),
  project: (data: ProjectDetail) => ({
    text: projectText(data, 'Статус проекта изменён'),
    entity: projectEntity(data),
  }),
  card: {
    title: 'Сменить статус проекта',
    summary: async (input, ctx) =>
      `${(await projectLabel(ctx, input.projectId)) ?? shortId(input.projectId)} → ${STATUS_LABEL[input.status]}`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Проект', await projectLabel(ctx, input.projectId)),
        field('Новый статус', STATUS_LABEL[input.status]),
      ]),
    consequences:
      'Проект получит выбранный статус; вернуть в работу можно отдельным действием. Архивация через ассистента недоступна. Автоматической отмены нет.',
  },
});

export const projectsJoinTool = defineTool({
  ...projectsPartsMeta['projects.join'],
  id: 'projects.join',
  title: 'Проекты: присоединиться',
  description:
    'Присоединиться к открытому проекту наблюдателем. Действие идемпотентно и появится карточкой подтверждения.',
  keywords: ['присоединиться к проекту', 'добавь меня в проект', 'наблюдать за проектом'],
  module: 'projects',
  kind: 'write',
  featureFlag: 'projects',
  hot: false,
  input: z.object({ projectId: z.uuid() }),
  api: { method: 'POST', path: '/projects/:id/join' },
  build: (input) => ({ method: 'POST', path: `/projects/${input.projectId}/join` }),
  project: (data: ProjectDetail) => ({
    text: projectText(data, 'Вы присоединились к проекту'),
    entity: projectEntity(data),
  }),
  card: {
    title: 'Присоединиться к проекту',
    summary: async (input, ctx) =>
      `Вы → ${(await projectLabel(ctx, input.projectId)) ?? shortId(input.projectId)}`,
    fields: async (input, ctx) =>
      fieldsOf([field('Проект', await projectLabel(ctx, input.projectId))]),
    consequences:
      'Вы станете наблюдателем проекта. Автоматической отмены нет — выйти можно действием «Покинуть проект».',
  },
});

export const projectsLeaveTool = defineTool({
  ...projectsPartsMeta['projects.leave'],
  id: 'projects.leave',
  title: 'Проекты: покинуть',
  description:
    'Покинуть проект, в который сотрудник вступил наблюдателем. Действие идемпотентно и появится карточкой подтверждения.',
  keywords: ['покинуть проект', 'выйти из проекта', 'убери меня из наблюдателей'],
  module: 'projects',
  kind: 'write',
  featureFlag: 'projects',
  hot: false,
  input: z.object({ projectId: z.uuid() }),
  api: { method: 'POST', path: '/projects/:id/leave' },
  build: (input) => ({ method: 'POST', path: `/projects/${input.projectId}/leave` }),
  project: (data: ProjectDetail) => ({
    text: projectText(data, 'Вы покинули проект'),
    entity: projectEntity(data),
  }),
  card: {
    title: 'Покинуть проект',
    summary: async (input, ctx) =>
      `Вы выходите из ${(await projectLabel(ctx, input.projectId)) ?? shortId(input.projectId)}`,
    fields: async (input, ctx) =>
      fieldsOf([field('Проект', await projectLabel(ctx, input.projectId))]),
    consequences:
      'Вы перестанете видеть проект как участник. Вступить снова можно действием «Присоединиться»; автоматической отмены нет.',
  },
});

export const projectsPartsTools = [
  projectsSetStatusTool,
  projectsJoinTool,
  projectsLeaveTool,
  ...projectsStructureWriteTools,
];
