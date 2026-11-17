import { describe, expect, it, vi } from 'vitest';

import { buildCatalog } from '../catalog.js';
import type { ToolContext } from '../tool-definition.js';
import {
  projectsJoinTool,
  projectsLeaveTool,
  projectsMoveNodeTool,
  projectsPartsTools,
  projectsSetStatusTool,
  projectsUpdateGroupTool,
  projectsUpdateNodeTool,
} from './projects-parts.tools.js';

/** #931: безопасные действия проекта — карточки с именами, тела по контракту. */

const P = '11111111-1111-4111-8111-111111111111';
const G = '22222222-2222-4222-8222-222222222222';
const N = '33333333-3333-4333-8333-333333333333';
const N2 = '44444444-4444-4444-8444-444444444444';
const K = '55555555-5555-4555-8555-555555555555';

const ctx: ToolContext = {
  authorization: 'Bearer t',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: vi.fn(async (path: string) => {
    if (path === `/projects/${P}`) return { id: P, name: 'Северный', code: 'Д-12' };
    if (path === '/projects/groups') return [{ id: G, name: 'Жилые объекты' }];
    if (path === `/projects/${P}/structure`)
      return {
        nodes: [
          { id: N, name: 'Раздел 1' },
          { id: N2, name: 'Сметы' },
        ],
      };
    if (path === '/projects/node-kinds') return [{ id: K, name: 'Раздел' }];
    return null;
  }),
};

describe('статус проекта', () => {
  it('завершение: тело и карточка с шифром и именем', async () => {
    const input = { projectId: P, status: 'completed' as const };
    expect(projectsSetStatusTool.build!(input)).toEqual({
      method: 'POST',
      path: `/projects/${P}/status`,
      body: { status: 'completed' },
    });
    expect(await projectsSetStatusTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([
        { label: 'Проект', value: 'Д-12 «Северный»' },
        { label: 'Новый статус', value: 'завершён' },
      ]),
    );
    expect(projectsSetStatusTool.card!.undo).toBeUndefined();
  });

  it('архивация через ассистента недоступна — схема не принимает archived', () => {
    expect(
      projectsSetStatusTool.input.safeParse({ projectId: P, status: 'archived' }).success,
    ).toBe(false);
  });
});

describe('участие в проекте', () => {
  it('присоединение и выход — отдельные идемпотентные действия', () => {
    expect(projectsJoinTool.build!({ projectId: P })).toEqual({
      method: 'POST',
      path: `/projects/${P}/join`,
    });
    expect(projectsLeaveTool.build!({ projectId: P })).toEqual({
      method: 'POST',
      path: `/projects/${P}/leave`,
    });
  });

  it('карточка присоединения называет проект, а не id', async () => {
    expect(await projectsJoinTool.card!.summary({ projectId: P }, ctx)).toContain(
      'Д-12 «Северный»',
    );
  });
});

describe('портфель и папки', () => {
  it('переименование портфеля: тело и старое имя в карточке', async () => {
    const input = { groupId: G, patch: { name: 'Жилые объекты 2' } };
    expect(projectsUpdateGroupTool.build!(input)).toEqual({
      method: 'PATCH',
      path: `/projects/groups/${G}`,
      body: { name: 'Жилые объекты 2' },
    });
    expect(await projectsUpdateGroupTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([
        { label: 'Портфель', value: 'Жилые объекты' },
        { label: 'Новое имя', value: 'Жилые объекты 2' },
      ]),
    );
  });

  it('правка папки: patch по контракту, вид человеческим именем', async () => {
    const input = {
      projectId: P,
      nodeId: N,
      patch: { name: 'Рабочая документация', kindId: K },
    };
    expect(projectsUpdateNodeTool.build!(input)).toEqual({
      method: 'PATCH',
      path: `/projects/${P}/nodes/${N}`,
      body: input.patch,
    });
    expect(await projectsUpdateNodeTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([
        { label: 'Проект', value: 'Д-12 «Северный»' },
        { label: 'Папка', value: 'Раздел 1' },
        { label: 'Вид', value: 'Раздел' },
      ]),
    );
  });

  it('перенос папки: родитель и позиция, не более одного якоря', async () => {
    const input = { projectId: P, nodeId: N, parentId: N2 };
    expect(projectsMoveNodeTool.build!(input)).toEqual({
      method: 'POST',
      path: `/projects/${P}/nodes/${N}/move`,
      body: { parentId: N2 },
    });
    expect(
      projectsMoveNodeTool.input.safeParse({
        projectId: P,
        nodeId: N,
        parentId: null,
        beforeId: N2,
        afterId: N,
      }).success,
    ).toBe(false);
    expect(await projectsMoveNodeTool.card!.summary(input, ctx)).toContain('Раздел 1 → Сметы');
  });
});

describe('каталог', () => {
  it('инструменты партии доступны при включённом проекте', () => {
    const catalog = buildCatalog({ permissions: ['assistant.use'], features: ['projects'] });
    const ids = catalog.map((tool) => tool.id);
    for (const tool of projectsPartsTools) {
      expect(ids, tool.id).toContain(tool.id);
      if (tool.kind === 'write') expect(tool.card, tool.id).toBeTruthy();
    }
  });
});
