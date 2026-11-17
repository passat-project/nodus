// @vitest-environment jsdom
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { demoPositions } from '../../../../shared/mocks/data/positions.js';
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
});
