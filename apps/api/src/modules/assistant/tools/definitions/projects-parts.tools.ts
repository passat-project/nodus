import { z } from 'zod';

import {
  projectGroupUpdateBodySchema,
  updateProjectNodeBodySchema,
  type ProjectDetail,
  type ProjectGroup,
  type ProjectNode,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asArray, asRecord, str } from '../projections.js';
import { field, fieldsOf, projectLabel, shortId } from './write-cards.js';
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

export const projectsUpdateGroupTool = defineTool({
  ...projectsPartsMeta['projects.update_group'],
  id: 'projects.update_group',
  title: 'Проекты: переименовать портфель',
  description:
    'Переименовать портфель (группу журнала проектов). Действие появится карточкой подтверждения; право управления проектами проверяет API.',
  keywords: ['переименовать портфель', 'переименовать группу проектов', 'название портфеля'],
  module: 'projects',
  kind: 'write',
  featureFlag: 'projects',
  hot: false,
  input: z.object({ groupId: z.uuid(), patch: projectGroupUpdateBodySchema }),
  api: { method: 'PATCH', path: '/projects/groups/:id' },
  build: (input) => ({
    method: 'PATCH',
    path: `/projects/groups/${input.groupId}`,
    body: input.patch,
  }),
  project: (data: ProjectGroup) => {
    const group = asRecord(data);
    return { text: `Портфель переименован: «${str(group?.name) ?? '—'}»` };
  },
  card: {
    title: 'Переименовать портфель',
    summary: async (input, ctx) =>
      `${(await groupName(ctx, input.groupId)) ?? shortId(input.groupId)} → «${input.patch.name ?? '—'}»`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Портфель', await groupName(ctx, input.groupId)),
        field('Новое имя', input.patch.name),
      ]),
    consequences:
      'Название портфеля изменится во всём журнале проектов. Автоматической отмены нет — верните прежнее имя вручную.',
  },
});

export const projectsUpdateNodeTool = defineTool({
  ...projectsPartsMeta['projects.update_node'],
  id: 'projects.update_node',
  title: 'Проекты: изменить папку',
  description:
    'Переименовать папку проекта, сменить шифр или вид. Действие появится карточкой подтверждения; права руководства проекта проверяет API.',
  keywords: ['переименовать папку', 'шифр папки', 'сменить вид папки', 'раздел проекта'],
  module: 'projects',
  kind: 'write',
  featureFlag: 'projects',
  hot: false,
  input: z.object({
    projectId: z.uuid(),
    nodeId: z.uuid(),
    patch: updateProjectNodeBodySchema,
  }),
  api: { method: 'PATCH', path: '/projects/:id/nodes/:nodeId' },
  build: (input) => ({
    method: 'PATCH',
    path: `/projects/${input.projectId}/nodes/${input.nodeId}`,
    body: input.patch,
  }),
  project: (data: ProjectNode, input) => {
    const node = asRecord(data);
    const name = str(node?.name) ?? 'папка';
    return {
      text: `Папка обновлена: «${name}»`,
      entity: { href: `?cards=project:${input.projectId}`, label: 'Проект' },
    };
  },
  card: {
    title: 'Изменить папку проекта',
    summary: async (input, ctx) =>
      `${(await nodeName(ctx, input.projectId, input.nodeId)) ?? shortId(input.nodeId)}: ${Object.keys(input.patch).join(', ')}`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Проект', await projectLabel(ctx, input.projectId)),
        field('Папка', await nodeName(ctx, input.projectId, input.nodeId)),
        field('Новое имя', input.patch.name),
        field('Шифр', input.patch.code === null ? 'очистить' : input.patch.code),
        field('Вид', await kindName(ctx, input.patch.kindId)),
        field('Атрибуты', input.patch.customFields ? 'изменены' : null),
      ]),
    consequences:
      'Имя, шифр и вид папки сохранятся в структуре проекта; смена вида может выдать номер. Автоматической отмены нет.',
  },
});

const moveInput = z
  .object({
    projectId: z.uuid(),
    nodeId: z.uuid(),
    parentId: z.uuid().nullable(),
    beforeId: z.uuid().nullable().optional(),
    afterId: z.uuid().nullable().optional(),
  })
  .refine((value) => !(value.beforeId && value.afterId), {
    message: 'не более одного якоря позиции',
  });

export const projectsMoveNodeTool = defineTool({
  ...projectsPartsMeta['projects.move_node'],
  id: 'projects.move_node',
  title: 'Проекты: перенести папку',
  description:
    'Перенести папку проекта к другому родителю (null — корень) или на позицию между соседями. Действие появится карточкой подтверждения.',
  keywords: ['перенести папку', 'переместить раздел', 'папку в корень', 'node move'],
  module: 'projects',
  kind: 'write',
  featureFlag: 'projects',
  hot: false,
  input: moveInput,
  api: { method: 'POST', path: '/projects/:id/nodes/:nodeId/move' },
  build: (input) => ({
    method: 'POST',
    path: `/projects/${input.projectId}/nodes/${input.nodeId}/move`,
    body: {
      parentId: input.parentId,
      ...(input.beforeId !== undefined ? { beforeId: input.beforeId } : {}),
      ...(input.afterId !== undefined ? { afterId: input.afterId } : {}),
    },
  }),
  project: (data: ProjectNode, input) => {
    const node = asRecord(data);
    return {
      text: `Папка перенесена: «${str(node?.name) ?? '—'}»`,
      entity: { href: `?cards=project:${input.projectId}`, label: 'Проект' },
    };
  },
  card: {
    title: 'Перенести папку проекта',
    summary: async (input, ctx) =>
      `${(await nodeName(ctx, input.projectId, input.nodeId)) ?? shortId(input.nodeId)} → ${input.parentId ? ((await nodeName(ctx, input.projectId, input.parentId)) ?? shortId(input.parentId)) : 'корень проекта'}`,
    fields: async (input, ctx) =>
      fieldsOf([
        field('Проект', await projectLabel(ctx, input.projectId)),
        field('Папка', await nodeName(ctx, input.projectId, input.nodeId)),
        field(
          'Новый родитель',
          input.parentId ? await nodeName(ctx, input.projectId, input.parentId) : 'корень проекта',
        ),
        field(
          'Позиция',
          input.beforeId ? 'перед соседом' : input.afterId ? 'после соседа' : 'в конце',
        ),
      ]),
    consequences:
      'Папка и её содержимое переедут в новое место структуры. Автоматической отмены нет — верните папку переносом.',
  },
});

async function structureNodes(ctx: ToolContext, projectId: string): Promise<unknown[]> {
  if (!ctx.read) return [];
  try {
    return asArray(asRecord(await ctx.read(`/projects/${projectId}/structure`))?.nodes);
  } catch {
    return [];
  }
}

async function nodeName(
  ctx: ToolContext,
  projectId: string,
  nodeId: string,
): Promise<string | null> {
  for (const raw of await structureNodes(ctx, projectId)) {
    const node = asRecord(raw);
    if (str(node?.id) === nodeId) return str(node?.name);
  }
  return null;
}

async function groupName(ctx: ToolContext, groupId: string): Promise<string | null> {
  if (!ctx.read) return null;
  try {
    for (const raw of asArray(await ctx.read('/projects/groups'))) {
      const group = asRecord(raw);
      if (str(group?.id) === groupId) return str(group?.name);
    }
  } catch {
    return null;
  }
  return null;
}

async function kindName(ctx: ToolContext, kindId: string | undefined): Promise<string | null> {
  if (!kindId || !ctx.read) return null;
  try {
    for (const raw of asArray(await ctx.read('/projects/node-kinds'))) {
      const kind = asRecord(raw);
      if (str(kind?.id) === kindId) return str(kind?.name);
    }
  } catch {
    return null;
  }
  return null;
}

/** Проект в карточке не должен превращаться в uuid, даже если имя не дочиталось. */
export const projectsPartsTools = [
  projectsSetStatusTool,
  projectsJoinTool,
  projectsLeaveTool,
  projectsUpdateGroupTool,
  projectsUpdateNodeTool,
  projectsMoveNodeTool,
];
