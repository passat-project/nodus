import { describe, expect, it, vi } from 'vitest';
import { Permission, type ProjectDetail, type ProjectGroup } from '@nodus/contracts';

import { buildCatalog } from '../catalog.js';
import type { ToolContext } from '../tool-definition.js';
import {
  projectsCreateGroupTool,
  projectsCreateTool,
  projectsGroupsTool,
  projectsNodeKindsTool,
  projectsTypesTool,
} from './projects-create.tools.js';

/**
 * #927: создание проекта и справочники для аргументов. Карточка показывает
 * имена (тип, портфель, заказчик, руководитель), тело — ровно контракт
 * `createProjectBodySchema`, права — API (`project.create`).
 */

const TYPE = '11111111-1111-4111-8111-111111111111';
const GROUP = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const PROJECT = '55555555-5555-4555-8555-555555555555';

const ctx: ToolContext = {
  authorization: 'Bearer t',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: vi.fn(async (path: string) => {
    if (path === '/projects/types') return [{ id: TYPE, name: 'Договор', archivedAt: null }];
    if (path === '/projects/groups') return [{ id: GROUP, name: 'Жилые объекты' }];
    if (path === '/projects/node-kinds') return [{ id: TYPE, name: 'Раздел', archivedAt: null }];
    if (path === `/counterparties/${CLIENT}`)
      return { id: CLIENT, shortName: 'Стройпроект', fullName: 'ООО «Стройпроект»' };
    if (path === `/directory/users/${USER}`) return { id: USER, displayName: 'Петров Пётр' };
    return null;
  }),
};

describe('projects.create: тело и карточка', () => {
  const input = {
    name: 'Договор №123',
    code: '2026-123',
    typeId: TYPE,
    portfolioId: GROUP,
    clientId: CLIENT,
    managerId: USER,
    assistantIds: [USER],
    observers: [USER],
    visibility: 'open' as const,
    startDate: '2026-11-01',
    endDate: '2027-11-01',
    description: 'Жилой дом на 120 квартир',
  };

  it('build отправляет ровно входные поля в POST /projects', () => {
    expect(projectsCreateTool.build!(input)).toEqual({
      method: 'POST',
      path: '/projects',
      body: input,
    });
  });

  it('карточка показывает человеческие имена вместо uuid', async () => {
    const summary = await projectsCreateTool.card!.summary(input, ctx);
    expect(summary).toContain('«Договор №123»');
    expect(summary).toContain('тип «Договор»');
    expect(summary).toContain('портфель «Жилые объекты»');
    expect(summary).toContain('руководитель Петров Пётр');
    const fields = await projectsCreateTool.card!.fields(input, ctx);
    const values = fields.map((field) => field.value);
    expect(values).toEqual(
      expect.arrayContaining([
        'Договор №123',
        '2026-123',
        'Договор',
        'Жилые объекты',
        'Стройпроект',
        'Петров Пётр',
        'открытый',
      ]),
    );
    expect(values.join(' ')).not.toContain(TYPE);
    expect(values.join(' ')).not.toContain(CLIENT);
  });

  it('создание проекта необратимо: undo не объявлен, карточка честно говорит', () => {
    expect(projectsCreateTool.card!.undo).toBeUndefined();
    expect(projectsCreateTool.card!.consequences).toContain('Удаления проекта в портале нет');
  });

  it('проекция возвращает ссылку на карточку созданного проекта', () => {
    const data = { id: PROJECT, name: 'Договор №123' } as unknown as ProjectDetail;
    expect(projectsCreateTool.project!(data, { name: 'Договор №123', typeId: TYPE })).toEqual({
      text: 'Проект создан: «Договор №123», id 55555555-5555-4555-8555-555555555555',
      entity: {
        href: '?cards=project:55555555-5555-4555-8555-555555555555',
        label: 'Договор №123',
      },
    });
  });

  it('право project.create: без него инструменты создания не попадают в каталог', () => {
    expect(projectsCreateTool.permission).toBe(Permission.PROJECT_CREATE);
    const without = buildCatalog({ permissions: ['assistant.use'], features: ['projects'] });
    expect(without.some((tool) => tool.id === 'projects.create')).toBe(false);
    const withRight = buildCatalog({
      permissions: ['assistant.use', Permission.PROJECT_CREATE],
      features: ['projects'],
    });
    expect(withRight.some((tool) => tool.id === 'projects.create')).toBe(true);
  });
});

describe('projects.create_group: портфель', () => {
  it('карточка и проекция называют портфель', async () => {
    const input = { name: 'Жилые объекты' };
    expect(projectsCreateGroupTool.build!(input)).toEqual({
      method: 'POST',
      path: '/projects/groups',
      body: { name: 'Жилые объекты' },
    });
    expect(await projectsCreateGroupTool.card!.summary(input, ctx)).toContain('Жилые объекты');
    expect(
      projectsCreateGroupTool.project!({ id: GROUP, name: 'Жилые объекты' } as ProjectGroup, {
        name: 'Жилые объекты',
      }),
    ).toEqual({ text: 'Портфель создан: «Жилые объекты»' });
  });
});

describe('справочники для аргументов: декларативные проекции', () => {
  it('types/groups/node-kinds читают массивы и отдают имена', () => {
    expect(
      projectsTypesTool.project!([{ id: TYPE, name: 'Договор', archivedAt: null }], {}),
    ).toEqual({
      text: 'Типы проектов: 1\n1. Тип: Договор',
    });
    expect(projectsGroupsTool.project!([{ id: GROUP, name: 'Жилые объекты' }], {})).toEqual({
      text: 'Портфели: 1\n1. Портфель: Жилые объекты',
    });
    expect(projectsNodeKindsTool.project!([{ id: TYPE, name: 'Раздел' }], {})).toEqual({
      text: 'Виды папок: 1\n1. Вид: Раздел',
    });
  });

  it('build типов передаёт includeArchived только по запросу', () => {
    expect(projectsTypesTool.build!({})).toEqual({ path: '/projects/types' });
    expect(projectsTypesTool.build!({ includeArchived: true })).toEqual({
      path: '/projects/types',
      query: { includeArchived: 'true' },
    });
  });
});
