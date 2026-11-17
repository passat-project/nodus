import { z } from 'zod';

import type { ProjectDetail, ProjectNode } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asArray, asRecord, asTyped, clip, str } from '../projections.js';
import { field, fieldsOf, projectName, shortId, userName } from './write-cards.js';

/**
 * Действия по проектам (Ф2, ADR-0048): название/описание, участник, папка
 * структуры. Права руководства проекта/помощников и `project.manage`
 * проверяет API; карточка показывает имена, а не id.
 */

const updateInput = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'Нужно хотя бы одно поле: name или description',
  });

export const projectsUpdateTool = defineTool({
  id: 'projects.update',
  title: 'Проекты: изменить',
  description:
    'Изменить название или описание проекта по id (null — очистить описание). Действие появится карточкой на подтверждение; права руководства проекта проверяет портал.',
  keywords: ['переименовать проект', 'изменить проект', 'описание проекта', 'update project'],
  module: 'projects',
  kind: 'write',
  featureFlag: 'projects',
  hot: false,
  input: updateInput,
  api: { method: 'PATCH', path: '/projects/:id' },
  build: (input) => ({
    method: 'PATCH',
    path: `/projects/${input.id}`,
    body: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  }),
  project: (data: ProjectDetail) => {
    const project = asTyped<ProjectDetail>(data);
    const id = str(project?.id);
    if (!id) return { text: 'Проект изменён' };
    const name = str(project?.name) ?? 'Проект';
    return {
      text: `Проект обновлён: «${name}», id ${id}`,
      entity: { href: `?cards=project:${id}`, label: name },
    };
  },
  card: {
    title: 'Изменить проект',
    summary: async (input, ctx) => {
      const name = await projectName(ctx, input.id);
      return `Изменения в проекте «${name ?? shortId(input.id)}»`;
    },
    fields: async (input, ctx) => {
      const name = await projectName(ctx, input.id);
      return fieldsOf([
        field('Проект', name ?? input.id),
        field('Новое название', input.name),
        field(
          'Описание',
          input.description === null
            ? 'очистить описание'
            : input.description
              ? clip(input.description, 400)
              : null,
        ),
      ]);
    },
    consequences:
      'Название и описание увидят все, кому виден проект. Изменение не откатывается автоматически.',
  },
});

const memberInput = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  kind: z.enum(['member', 'observer']),
});

export const projectsAddMemberTool = defineTool({
  id: 'projects.add_member',
  title: 'Проекты: добавить участника',
  description:
    'Добавить сотрудника в проект: participant («member») или наблюдатель («observer»). Действие появится карточкой на подтверждение; правило «в открытый — только наблюдатель» проверяет портал.',
  keywords: ['добавить участника', 'наблюдатель', 'состав проекта', 'add member'],
  module: 'projects',
  kind: 'write',
  featureFlag: 'projects',
  hot: false,
  input: memberInput,
  api: { method: 'POST', path: '/projects/:id/members' },
  build: (input) => ({
    method: 'POST',
    path: `/projects/${input.id}/members`,
    body: { userId: input.userId, kind: input.kind },
  }),
  // API отвечает 201 без тела (Promise<void>): id берём из входа.
  project: (data: void, input) => {
    const id = str(asRecord(data)?.id) ?? input.id;
    return {
      text: `Участник добавлен в проект (id ${id})`,
      entity: { href: `?cards=project:${id}`, label: 'Проект' },
    };
  },
  card: {
    title: 'Добавить участника проекта',
    summary: async (input, ctx) => {
      const [project, user] = await Promise.all([
        projectName(ctx, input.id),
        userName(ctx, input.userId),
      ]);
      return `${user ?? 'Сотрудник'} → проект «${project ?? shortId(input.id)}» (${input.kind === 'member' ? 'участник' : 'наблюдатель'})`;
    },
    fields: async (input, ctx) => {
      const [project, user] = await Promise.all([
        projectName(ctx, input.id),
        userName(ctx, input.userId),
      ]);
      return fieldsOf([
        field('Проект', project ?? input.id),
        field('Сотрудник', user ?? input.userId),
        field('Роль', input.kind === 'member' ? 'Участник' : 'Наблюдатель'),
      ]);
    },
    consequences:
      'Сотрудник получит доступ к проекту по своей роли. Добавление можно отменить кнопкой «Отменить».',
    undo: (input) => ({
      method: 'DELETE',
      path: `/projects/${input.id}/members/${input.userId}`,
    }),
  },
});

const nodeInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  kindId: z.uuid(),
  parentId: z.uuid().nullable().optional(),
});

export const projectsAddNodeTool = defineTool({
  id: 'projects.add_node',
  title: 'Проекты: создать папку',
  description:
    'Создать папку структуры проекта по виду (kindId из projects.structure): название, вид, при желании родительская папка. Действие появится карточкой на подтверждение; права и обязательные атрибуты вида проверяет портал.',
  keywords: ['создать папку', 'работа', 'структура проекта', 'узел', 'add folder'],
  module: 'projects',
  kind: 'write',
  featureFlag: 'projects',
  hot: false,
  input: nodeInput,
  api: { method: 'POST', path: '/projects/:id/nodes' },
  build: (input) => ({
    method: 'POST',
    path: `/projects/${input.id}/nodes`,
    body: {
      name: input.name,
      kindId: input.kindId,
      ...(input.parentId ? { parentId: input.parentId } : {}),
    },
  }),
  project: (data: ProjectNode, input) => {
    const node = asTyped<ProjectNode>(data);
    const id = str(node?.id);
    const name = str(node?.name) ?? 'Папка';
    if (!id) return { text: 'Папка создана' };
    return {
      text: `Папка создана: «${name}», id ${id}`,
      entity: { href: `?cards=project:${input.id}`, label: name },
    };
  },
  card: {
    title: 'Создать папку проекта',
    summary: async (input, ctx) => {
      const [project, structure] = await Promise.all([
        projectName(ctx, input.id),
        readStructure(ctx, input.id),
      ]);
      const kind = structure?.kinds.find((item) => item.id === input.kindId)?.name;
      return `«${input.name}»${kind ? ` (${kind})` : ''} в проекте «${project ?? shortId(input.id)}»`;
    },
    fields: async (input, ctx) => {
      const [project, structure] = await Promise.all([
        projectName(ctx, input.id),
        readStructure(ctx, input.id),
      ]);
      const kind = structure?.kinds.find((item) => item.id === input.kindId)?.name;
      const parent = input.parentId
        ? structure?.nodes.find((item) => item.id === input.parentId)?.name
        : null;
      return fieldsOf([
        field('Проект', project ?? input.id),
        field('Название', input.name),
        field('Вид', kind ?? input.kindId),
        field('Внутри папки', parent),
      ]);
    },
    consequences:
      'Папка появится в структуре проекта. Созданную папку можно удалить кнопкой «Отменить».',
    undo: (input, output) => {
      const node = asRecord(output);
      const nodeId = str(node?.id);
      return nodeId ? { method: 'DELETE', path: `/projects/${input.id}/nodes/${nodeId}` } : null;
    },
  },
});

interface StructureInfo {
  kinds: { id: string; name: string }[];
  nodes: { id: string; name: string }[];
}

async function readStructure(ctx: ToolContext, projectId: string): Promise<StructureInfo | null> {
  try {
    const raw = asRecord(await ctx.read?.(`/projects/${projectId}/structure`));
    if (!raw) return null;
    return {
      kinds: asArray(raw.kinds).flatMap((value) => {
        const kind = asRecord(value);
        const id = str(kind?.id);
        const name = str(kind?.name);
        return id && name ? [{ id, name }] : [];
      }),
      nodes: asArray(raw.nodes).flatMap((value) => {
        const node = asRecord(value);
        const id = str(node?.id);
        const name = str(node?.name);
        return id && name ? [{ id, name }] : [];
      }),
    };
  } catch {
    return null;
  }
}

export const projectsWriteTools = [projectsUpdateTool, projectsAddMemberTool, projectsAddNodeTool];
