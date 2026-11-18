import { z } from 'zod';
import {
  Permission,
  createProjectBodySchema,
  type ProjectDetail,
  type ProjectGroup,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import type { ToolActionField, ToolContext } from '../tool-definition.js';
import { asArray, asRecord, asTyped, clip, nameOf, str } from '../projections.js';
import { field, fieldsOf, humanDate, shortId, userName } from './write-cards.js';
import { projectsCreateMeta } from './meta/projects-create.meta.js';

/**
 * Создание проекта (#927): справочники типа/портфеля, сам проект и портфель.
 * Без чтения типов модель не выберет `typeId`; без карточки запись не
 * происходит (ADR-0048). Карточка показывает человеческие имена, а не uuid:
 * тип, портфель, заказчик, руководитель, помощники, наблюдатели.
 */

const listInput = z.object({ includeArchived: z.boolean().optional() });

export const projectsTypesTool = defineTool({
  ...projectsCreateMeta['projects.types'],
  id: 'projects.types',
  title: 'Проекты: типы',
  description:
    'Справочник типов проектов (Договор, Тема, …) с id: нужен, чтобы выбрать typeId для projects.create. includeArchived — показать архивные.',
  keywords: ['типы проектов', 'вид проекта', 'договор', 'тема', 'typeId', 'project types'],
  module: 'projects',
  kind: 'read',
  featureFlag: 'projects',
  hot: false,
  input: listInput,
  api: { method: 'GET', path: '/projects/types' },
  build: (input) => ({
    path: '/projects/types',
    ...(input.includeArchived ? { query: { includeArchived: 'true' } } : {}),
  }),
  projection: {
    kind: 'list',
    heading: 'Типы проектов',
    fields: [
      { path: 'name', label: 'Тип' },
      { path: 'archivedAt', label: 'Архив с', format: 'date' },
    ],
  },
});

export const projectsGroupsTool = defineTool({
  ...projectsCreateMeta['projects.groups'],
  id: 'projects.groups',
  title: 'Проекты: портфели',
  description:
    'Список портфелей (групп журнала проектов) с id: нужен для portfolioId при создании проекта и переносе между портфелями.',
  keywords: ['портфели', 'группы проектов', 'портфель', 'portfolio', 'project groups'],
  module: 'projects',
  kind: 'read',
  featureFlag: 'projects',
  hot: false,
  input: z.object({}),
  api: { method: 'GET', path: '/projects/groups' },
  build: () => ({ path: '/projects/groups' }),
  projection: {
    kind: 'list',
    heading: 'Портфели',
    fields: [{ path: 'name', label: 'Портфель' }],
  },
});

export const projectsNodeKindsTool = defineTool({
  ...projectsCreateMeta['projects.node_kinds'],
  id: 'projects.node_kinds',
  title: 'Проекты: виды папок',
  description:
    'Справочник видов папок структуры проекта (раздел, комплект, работа) с id: нужен для kindId при создании папки projects.add_node.',
  keywords: ['виды папок', 'вид папки', 'kindId', 'структура проекта', 'node kinds'],
  module: 'projects',
  kind: 'read',
  featureFlag: 'projects',
  hot: false,
  input: z.object({}),
  api: { method: 'GET', path: '/projects/node-kinds' },
  build: () => ({ path: '/projects/node-kinds' }),
  projection: {
    kind: 'list',
    heading: 'Виды папок',
    fields: [
      { path: 'name', label: 'Вид' },
      { path: 'archivedAt', label: 'Архив с', format: 'date' },
    ],
  },
});

const VISIBILITY_LABEL: Record<string, string> = {
  open: 'открытый',
  secret: 'секретный',
};

export const projectsCreateTool = defineTool({
  ...projectsCreateMeta['projects.create'],
  id: 'projects.create',
  title: 'Проекты: создать',
  description:
    'Создать проект (договор или тему): название и тип обязательны; шифр, описание, портфель, заказчик, руководитель, помощники, наблюдатели, видимость и даты — по желанию. Действие появится карточкой подтверждения; права project.create и обязательные атрибуты типа проверяет портал.',
  keywords: [
    'создать проект',
    'завести проект',
    'новый проект',
    'новый договор',
    'тема проекта',
    'create project',
  ],
  module: 'projects',
  kind: 'write',
  permission: Permission.PROJECT_CREATE,
  featureFlag: 'projects',
  hot: false,
  // Пустой сегмент номера подтверждает человек в интерфейсе (#630), не модель.
  input: createProjectBodySchema.omit({ confirmEmptyNumberParts: true }),
  api: { method: 'POST', path: '/projects' },
  build: (input) => ({ method: 'POST', path: '/projects', body: input }),
  project: (data: ProjectDetail) => {
    const project = asTyped<ProjectDetail>(data);
    const id = str(project?.id);
    const name = str(project?.name) ?? 'Проект';
    if (!id) return { text: `Проект создан: «${name}»` };
    return {
      text: `Проект создан: «${name}», id ${id}`,
      entity: { href: `?cards=project:${id}`, label: name },
    };
  },
  card: {
    title: 'Создать проект',
    summary: async (input, ctx) => {
      const [type, portfolio, manager] = await Promise.all([
        catalogName(ctx, '/projects/types', input.typeId),
        input.portfolioId ? catalogName(ctx, '/projects/groups', input.portfolioId) : null,
        input.managerId ? userName(ctx, input.managerId) : null,
      ]);
      return [
        `«${input.name}»`,
        type ? `тип «${type}»` : null,
        portfolio ? `портфель «${portfolio}»` : null,
        manager ? `руководитель ${manager}` : null,
      ]
        .filter(Boolean)
        .join(', ');
    },
    fields: async (input, ctx) => {
      const [type, portfolio, client, manager, assistants, observers] = await Promise.all([
        catalogName(ctx, '/projects/types', input.typeId),
        input.portfolioId ? catalogName(ctx, '/projects/groups', input.portfolioId) : null,
        input.clientId ? counterpartyName(ctx, input.clientId) : null,
        input.managerId ? userName(ctx, input.managerId) : null,
        names(ctx, input.assistantIds),
        names(ctx, input.observers),
      ]);
      return fieldsOf([
        field('Название', input.name),
        field('Шифр', input.code),
        field('Тип', type ?? input.typeId),
        field('Портфель', portfolio),
        field('Заказчик', client),
        field('Руководитель', manager ?? 'создатель (по умолчанию)'),
        field('Помощники', assistants),
        field('Наблюдатели', observers),
        field('Видимость', input.visibility ? VISIBILITY_LABEL[input.visibility] : null),
        field(
          'Срок',
          [humanDate(input.startDate), humanDate(input.endDate)].filter(Boolean).join(' — ') ||
            null,
        ),
        field('Описание', input.description ? clip(input.description, 400) : null),
        field(
          'Атрибуты',
          input.customFields && Object.keys(input.customFields).length > 0
            ? `заполнено полей: ${Object.keys(input.customFields).length}`
            : null,
        ),
      ]);
    },
    consequences:
      'Проект появится в журнале и будет виден согласно видимости (секретный — только участникам). Удаления проекта в портале нет: отмена невозможна, завершение/архив — отдельным действием.',
  },
});

export const projectsCreateGroupTool = defineTool({
  ...projectsCreateMeta['projects.create_group'],
  id: 'projects.create_group',
  title: 'Проекты: создать портфель',
  description:
    'Создать портфель (группу журнала проектов) с названием. Действие появится карточкой подтверждения; право project.create проверяет портал.',
  keywords: ['создать портфель', 'новая группа проектов', 'портфель', 'create portfolio'],
  module: 'projects',
  kind: 'write',
  permission: Permission.PROJECT_CREATE,
  featureFlag: 'projects',
  hot: false,
  input: z.object({ name: z.string().trim().min(1).max(120) }),
  api: { method: 'POST', path: '/projects/groups' },
  build: (input) => ({ method: 'POST', path: '/projects/groups', body: { name: input.name } }),
  project: (data: ProjectGroup) => {
    const group = asTyped<ProjectGroup>(data);
    const name = str(group?.name) ?? 'Портфель';
    return { text: `Портфель создан: «${name}»` };
  },
  card: {
    title: 'Создать портфель',
    summary: (input) => `Новый портфель «${input.name}»`,
    fields: (input) =>
      [field('Название', input.name)].filter((item): item is ToolActionField => Boolean(item)),
    consequences:
      'Портфель появится в журнале проектов; проекты в него добавляются отдельно. Удаление портфеля через ассистента не выполняется.',
  },
});

/** Имя из массива-справочника (`[{ id, name }]`) по id. */
async function catalogName(ctx: ToolContext, path: string, id: string): Promise<string | null> {
  try {
    const raw = await ctx.read?.(path);
    const items = Array.isArray(raw) ? raw : asArray(asRecord(raw)?.items);
    const found = items.map((item) => asRecord(item)).find((item) => str(item?.id) === id);
    return nameOf(found) ?? null;
  } catch {
    return null;
  }
}

async function counterpartyName(ctx: ToolContext, id: string): Promise<string | null> {
  try {
    const record = asRecord(await ctx.read?.(`/counterparties/${id}`));
    return str(record?.shortName) ?? str(record?.fullName) ?? null;
  } catch {
    return null;
  }
}

async function names(ctx: ToolContext, ids: readonly string[] | undefined): Promise<string | null> {
  if (!ids || ids.length === 0) return null;
  const resolved = await Promise.all(ids.map((id) => userName(ctx, id)));
  return resolved.map((name, index) => name ?? shortId(ids[index]!)).join(', ') || null;
}

export const projectsCreateTools = [
  projectsTypesTool,
  projectsGroupsTool,
  projectsNodeKindsTool,
  projectsCreateTool,
  projectsCreateGroupTool,
];
