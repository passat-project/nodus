// @vitest-environment jsdom
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DepartmentNode } from '@nodus/contracts';

import { DEPARTMENTS_TREE_PATH } from '../../../../shared/api/departments-list.js';
import { demoPositions } from '../../../../shared/mocks/data/positions.js';
import { userIds } from '../../../../shared/mocks/data/users.js';
import { directoryHandlers } from './directory-handlers.js';

/**
 * Моки должностей (#768): семантика держателей — как на сервере и в панели
 * (вердикт 13.11.2026) — ВСЕ, включая уволенных; иначе в мок-режиме поток
 * «переназначить → удалить» не завершается: счётчик не обнуляется, DELETE снова
 * отвечает 409, хотя на живом контуре должность уже удалена.
 */
const server = setupServer(...directoryHandlers);
const URL = '/api/v1/directory/positions';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const positionId = (name: string): string => {
  const position = demoPositions.find((item) => item.name === name);
  if (!position) throw new Error(`Нет демо-должности ${name}`);
  return position.id;
};

describe('моки должностей (#768)', () => {
  it('переназначение переводит и уволенных держателей — должность удаляется', async () => {
    const sourceId = positionId('Инженер-проектировщик');
    const targetId = positionId('БИМ-менеджер');

    // В демо-данных у «Инженер-проектировщика» есть уволенный держатель:
    // без него должность удалилась бы сразу, а с ним — только после перевода.
    const blocked = await fetch(`${URL}/${sourceId}`, { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as { details?: { reason?: string } };
    expect(blockedBody.details).toMatchObject({ reason: 'holders' });

    const reassign = await fetch(`${URL}/${sourceId}/reassign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId }),
    });
    expect(reassign.status).toBe(204);

    const removed = await fetch(`${URL}/${sourceId}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);

    const list = await fetch(`${URL}?kind=management`);
    const positions = (await list.json()) as { id: string }[];
    expect(positions.some((position) => position.id === sourceId)).toBe(false);
  });

  it('дубль имени (без учёта регистра) — 409 как на сервере; после удаления имя свободно', async () => {
    const duplicate = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'дИРЕКТОР', kind: 'management', sortOrder: 0 }),
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { code: string }).code).toBe('DIRECTORY_POSITION_EXISTS');

    // Жёсткое удаление освобождает имя: та же строка создаётся заново.
    const create = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Проба мока 768', kind: 'management', sortOrder: 0 }),
    });
    expect(create.status).toBe(201);
    const createdId = ((await create.json()) as { id: string }).id;

    const removed = await fetch(`${URL}/${createdId}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);

    const recreated = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Проба мока 768', kind: 'management', sortOrder: 0 }),
    });
    expect(recreated.status).toBe(201);
    expect(((await recreated.json()) as { id: string }).id).not.toBe(createdId);
  });
});

describe('моки подразделений: глава/зам — одно место (#946)', () => {
  const DEPARTMENTS = '/api/v1/directory/departments';
  const TREE = `/api/v1${DEPARTMENTS_TREE_PATH}?kind=management`;

  const create = (body: Record<string, unknown>) =>
    fetch(DEPARTMENTS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('назначение главы переводит сотрудника; прежний узел теряет роль', async () => {
    const response = await create({
      name: 'Мок-перевод #946',
      kind: 'management',
      headId: userIds.karpovich,
    });
    expect(response.status).toBe(201);
    const department = (await response.json()) as { id: string };

    const tree = (await (await fetch(TREE)).json()) as DepartmentNode[];
    const flatten = (nodes: DepartmentNode[]): DepartmentNode[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children)]);
    const all = flatten(tree);
    const createdNode = all.find((node) => node.id === department.id);
    expect(createdNode?.memberCount).toBe(1);
    expect(createdNode?.headName).toContain('Карпович');
    // Прежний узел Карпович («Административное») остался без главы.
    const previous = all.find((node) => node.name === 'Административное');
    expect(previous?.headId).toBeNull();
  });

  it('глава и зам — один сотрудник → 400 как на сервере', async () => {
    const response = await create({
      name: 'Мок-дубль #946',
      kind: 'management',
      headId: userIds.polomar,
      deputyId: userIds.polomar,
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('VALIDATION_FAILED');
  });
});
