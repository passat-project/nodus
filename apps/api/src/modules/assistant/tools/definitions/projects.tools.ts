import { z } from 'zod';

import { defineTool } from '../tool-definition.js';
import {
  asArray,
  asRecord,
  clip,
  date,
  dateTime,
  entityLink,
  finalize,
  hasMore,
  itemsOf,
  listBlock,
  nameOf,
  num,
  str,
} from '../projections.js';

/**
 * Инструменты проектов (#892): журнал, карточка, структура (дерево папок и
 * файлов) и состав участников. Чтение — в пределах видимости проекта
 * (участие и права сотрудника решает API).
 */

const listInput = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  role: z.enum(['manager', 'assistant', 'participant', 'observer']).optional(),
  status: z.enum(['active', 'completed', 'archived']).optional(),
  search: z.string().trim().min(1).max(128).optional(),
  memberId: z.uuid().optional(),
  limit: z.number().int().min(1).max(20).default(20),
});

function projectRow(raw: unknown): string | null {
  const project = asRecord(raw);
  if (!project) return null;
  const id = str(project.id);
  const name = str(project.name);
  if (!id || !name) return null;
  const parts = [
    `«${name}»${str(project.code) ? ` (шифр ${str(project.code)})` : ''}`,
    `статус ${str(project.status) ?? '—'}`,
    `руководитель ${nameOf(project.manager) ?? '—'}`,
    `участников ${num(project.membersCount) ?? 0}`,
  ];
  if (str(project.endDate)) parts.push(`срок ${date(project.endDate)}`);
  const client = asRecord(project.client);
  if (client) parts.push(`заказчик «${nameOf(client) ?? '—'}»`);
  if (project.visibility === 'secret') parts.push('секретный');
  parts.push(`id ${id}`);
  return parts.join(', ');
}

export const projectsListTool = defineTool({
  id: 'projects.list',
  title: 'Проекты: список',
  description:
    'Список видимых проектов: мои/все, по роли, статусу, поиск по названию и шифру. Отдаёт название, шифр, статус, руководителя, состав и id.',
  keywords: ['проекты', 'проект', 'договор', 'портфель', 'стройка', 'projects'],
  module: 'projects',
  kind: 'read',
  featureFlag: 'projects',
  hot: true,
  input: listInput,
  api: { method: 'GET', path: '/projects' },
  build: (input) => ({
    path: '/projects',
    query: {
      scope: input.scope,
      limit: String(input.limit),
      ...(input.role ? { role: input.role } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.search ? { search: input.search } : {}),
      ...(input.memberId ? { memberId: input.memberId } : {}),
    },
  }),
  project: (data) => {
    const rows = itemsOf(data)
      .map(projectRow)
      .filter((row): row is string => row !== null);
    // Ссылка «Открыть» — у карточки проекта (projects.get), не у списка.
    return { text: finalize(listBlock('Проекты', rows, { more: hasMore(data) })) };
  },
});

const getInput = z.object({ id: z.uuid() });

export const projectsGetTool = defineTool({
  id: 'projects.get',
  title: 'Проекты: карточка',
  description:
    'Карточка проекта по id: тип, статус, руководство, состав, заказчик, сроки и описание. Нужен id из projects.list.',
  keywords: ['проект', 'карточка', 'о проекте', 'детали', 'описание'],
  module: 'projects',
  kind: 'read',
  featureFlag: 'projects',
  hot: true,
  input: getInput,
  api: { method: 'GET', path: '/projects/:id' },
  build: (input) => ({ path: `/projects/${input.id}` }),
  project: (data) => {
    const project = asRecord(data);
    const id = str(project?.id);
    const name = str(project?.name);
    if (!project || !id || !name) return { text: 'Проект не найден или недоступен' };
    const members = asArray(project.members ?? project.membersPreview)
      .map(nameOf)
      .filter(Boolean);
    const lines = [
      `«${name}»${str(project.code) ? ` (шифр ${str(project.code)})` : ''} (id ${id})`,
      `Статус: ${str(project.status) ?? '—'}${project.visibility === 'secret' ? ', секретный' : ''}`,
      `Руководитель: ${nameOf(project.manager) ?? '—'}`,
      `Помощники: ${asArray(project.assistants).map(nameOf).filter(Boolean).join(', ') || 'нет'}`,
      `Участники (${num(project.membersCount) ?? members.length}): ${members.slice(0, 10).join(', ') || '—'}`,
      `Заказчик: ${nameOf(project.client) ?? '—'}`,
      `Срок: ${str(project.endDate) ? date(project.endDate) : 'не задан'}`,
      `Создан: ${dateTime(project.createdAt) ?? '—'}`,
      str(project.description)
        ? `Описание: ${clip(str(project.description)!, 600)}`
        : 'Описание: пусто',
    ];
    return {
      text: finalize(lines.join('\n')),
      entity: entityLink('project', id, name),
    };
  },
});

const structureInput = z.object({
  id: z.uuid(),
  /** Сколько узлов дерева показывать (дерево бывает большим). */
  limit: z.number().int().min(1).max(60).default(40),
});

/** Плоский обход дерева структуры проекта: имя, вид, вложенность. */
function walkNodes(nodes: unknown[], depth: number, out: string[], limit: number): void {
  for (const raw of nodes) {
    if (out.length >= limit) return;
    const node = asRecord(raw);
    if (!node) continue;
    const name = str(node.name) ?? str(node.title) ?? '—';
    const kind = asRecord(node.kind);
    const files = asArray(node.files).length;
    out.push(
      `${'  '.repeat(Math.min(depth, 6))}${kind ? `[${str(kind.name) ?? 'раздел'}] ` : ''}${name}${files ? ` — файлов ${files}` : ''}`,
    );
    walkNodes(asArray(node.children), depth + 1, out, limit);
  }
}

export const projectsStructureTool = defineTool({
  id: 'projects.structure',
  title: 'Проекты: структура',
  description:
    'Дерево структуры проекта: папки-разделы и файлы (имена и количество). Отвечает на «что в проекте», «какие разделы», «есть ли документ».',
  keywords: ['структура', 'дерево', 'папки', 'разделы', 'документы', 'файлы', 'structure'],
  module: 'projects',
  kind: 'read',
  featureFlag: 'projects',
  hot: false,
  input: structureInput,
  api: { method: 'GET', path: '/projects/:id/structure' },
  build: (input) => ({ path: `/projects/${input.id}/structure` }),
  project: (data, input) => {
    const root = asRecord(data);
    const nodes = asArray(root?.nodes ?? root?.tree ?? root?.children);
    const out: string[] = [];
    walkNodes(nodes, 0, out, input.limit);
    if (out.length === 0) return { text: 'Структура проекта пуста или недоступна' };
    return {
      text: finalize(
        [
          `Структура проекта (${out.length} узлов${out.length >= input.limit ? ', показаны первые' : ''}):`,
          ...out,
        ].join('\n'),
      ),
    };
  },
});

const membersInput = z.object({
  id: z.uuid(),
  limit: z.number().int().min(1).max(50).default(30),
});

export const projectsMembersTool = defineTool({
  id: 'projects.members',
  title: 'Проекты: участники',
  description:
    'Состав проекта с ролями: руководитель, помощники, участники, наблюдатели. Отвечает на «кто в проекте», «кто отвечает за раздел».',
  keywords: ['участники', 'состав', 'команда', 'роли', 'кто в проекте', 'members'],
  module: 'projects',
  kind: 'read',
  featureFlag: 'projects',
  hot: false,
  input: membersInput,
  api: { method: 'GET', path: '/projects/:id/members' },
  build: (input) => ({
    path: `/projects/${input.id}/members`,
    query: { limit: String(input.limit) },
  }),
  project: (data) => {
    const rows = itemsOf(data).map((raw) => {
      const member = asRecord(raw);
      if (!member) return null;
      const user = asRecord(member.user) ?? member;
      return `${nameOf(user) ?? '—'} — ${str(member.role) ?? 'участник'}`;
    });
    return {
      text: finalize(
        listBlock(
          'Участники проекта',
          rows.filter((row): row is string => row !== null),
          { maxRows: 50 },
        ),
      ),
    };
  },
});

export const projectsTools = [
  projectsListTool,
  projectsGetTool,
  projectsStructureTool,
  projectsMembersTool,
];
