// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import { useAuthStore } from '../../auth-store.js';
import { customFieldsHandlers } from './custom-fields-handlers.js';

/**
 * Паритет мок-реестра атрибутов с сервером (#646): право
 * `custom_field.manage` проверяется на КАЖДОЙ мутации и на usage — без
 * права мок отвечает 403, как сервер, а не выполняет операцию.
 */
const server = setupServer(...customFieldsHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function signIn(permissions: string[]): void {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: null,
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'user@nodus.by',
      displayName: 'Пользователь',
      permissions,
    },
  });
}

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('мок custom-fields: право custom_field.manage (#646)', () => {
  beforeEach(() => signIn([]));

  it('без права — 403 на create/patch/delete/order/usage/company-value', async () => {
    const create = await fetch(
      '/api/v1/custom-fields/definitions',
      json('POST', {
        type: 'text',
        name: 'Проба прав',
      }),
    );
    expect(create.status).toBe(403);
    expect(((await create.json()) as { code: string }).code).toBe(ErrorCode.FORBIDDEN);

    const usage = await fetch(
      '/api/v1/custom-fields/definitions/c0000000-0000-4000-8000-0000000000aa/usage',
    );
    expect(usage.status).toBe(403);

    const patch = await fetch(
      '/api/v1/custom-fields/definitions/c0000000-0000-4000-8000-0000000000aa',
      json('PATCH', { hint: 'x' }),
    );
    expect(patch.status).toBe(403);

    const remove = await fetch(
      '/api/v1/custom-fields/definitions/c0000000-0000-4000-8000-0000000000aa',
      json('DELETE'),
    );
    expect(remove.status).toBe(403);

    const order = await fetch('/api/v1/custom-fields/definitions/order', json('PUT', { ids: [] }));
    expect(order.status).toBe(403);
  });

  it('с правом — создание проходит; без права список читается', async () => {
    signIn([Permission.CUSTOM_FIELD_MANAGE]);
    const created = await fetch(
      '/api/v1/custom-fields/definitions',
      json('POST', {
        type: 'text',
        name: `Проба прав ${crypto.randomUUID()}`,
      }),
    );
    expect(created.status, await created.clone().text()).toBe(201);

    signIn([]);
    const list = await fetch('/api/v1/custom-fields/definitions');
    expect(list.status).toBe(200);
  });

  it('неизвестный module — 400, как серверная схема', async () => {
    signIn([]);
    const response = await fetch('/api/v1/custom-fields/definitions?module=bogus');
    expect(response.status).toBe(400);
  });
});
