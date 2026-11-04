// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Permission, type Dictionary } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import { useAuthStore } from '../../auth-store.js';
import { workKindIds } from '../../mocks/data/dictionaries.js';
import { dictionariesHandlers } from './dictionaries-handlers.js';

/** #491: мок-сервер повторяет серверную проверку `dictionary.manage` —
 *  без права создание справочника и правка вариантов отвечают 403. */

const server = setupServer(...dictionariesHandlers);
const URL = '/api/v1/dictionaries';

function actor(permissions: Permission[]) {
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'admin@nodus.by',
      displayName: 'Администратор Системный',
      permissions,
    },
  });
}

async function createDictionary(name: string) {
  return fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, items: ['Первый'] }),
  });
}

describe('моки справочников: проверка dictionary.manage (#491)', () => {
  beforeEach(() => {
    server.listen({ onUnhandledRequest: 'error' });
    return () => server.close();
  });

  it('без права — 403 FORBIDDEN и справочник не создаётся', async () => {
    actor([Permission.CUSTOM_FIELD_MANAGE]);
    const response = await createDictionary('Без права');
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(ErrorCode.FORBIDDEN);
  });

  it('без права — 403 и на правку варианта', async () => {
    actor([Permission.CUSTOM_FIELD_MANAGE]);
    const response = await fetch(`/api/v1/dictionaries/work-kind/items/${workKindIds.design}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Новое имя' }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(ErrorCode.FORBIDDEN);
  });

  it('с правом — 201 и справочник создаётся', async () => {
    actor([Permission.CUSTOM_FIELD_MANAGE, Permission.DICTIONARY_MANAGE]);
    const response = await createDictionary('С правом');
    expect(response.status).toBe(201);
    expect(((await response.json()) as Dictionary).name).toBe('С правом');
  });
});
