import { z } from 'zod';

import {
  Permission,
  projectGroupUpdateBodySchema,
  updateProjectNodeBodySchema,
  type ProjectGroup,
  type ProjectNode,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asArray, asRecord, str } from '../projections.js';
import { field, fieldsOf, projectLabel, shortId } from './write-cards.js';
import { projectsPartsMeta } from './meta/projects-parts.meta.js';

/**
 * Структура проекта (#931): портфель (группа журнала), папки и их перенос.
 * Без удаления, архивации и смены типа — только переименование и место в дереве.
 */

export const projectsUpdateGroupTool = defineTool({
  ...projectsPartsMeta['projects.update_group'],
  id: 'projects.update_group',
  title: 'Проекты: переименовать портфель',
  description:
    'Переименовать портфель (группу журнала проектов). Действие появится карточкой подтверждения; право управления проектами проверяет API.',
  keywords: ['переименовать портфель', 'переименовать группу проектов', 'название портфеля'],
  module: 'projects',
  kind: 'write',
  permission: Permission.PROJECT_MANAGE,
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
    // Подтверждение пустого сегмента номера (#630) остаётся человеку в
    // интерфейсе: модель не может подтвердить это за сотрудника.
    patch: z.preprocess((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const copy = { ...(value as Record<string, unknown>) };
      delete copy.confirmEmptyNumberParts;
      return copy;
    }, updateProjectNodeBodySchema),
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

export const projectsStructureWriteTools = [
  projectsUpdateGroupTool,
  projectsUpdateNodeTool,
  projectsMoveNodeTool,
];
