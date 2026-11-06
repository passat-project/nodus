// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Permission } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import { useAuthStore } from '../../../../shared/auth-store.js';
// Порядок как в app/mocks-handlers: реестр атрибутов — раньше данных.
import '../../../../shared/custom-fields/mocks/custom-fields-handlers.js';
import { demoTasks } from '../../../../shared/mocks/data/tasks.js';
import { tasksHandlers } from './tasks-handlers.js';

/** Демо-мир: формульных переносов нет — превью задачи обязано ответить пустым
 *  диффом, иначе UI показывал бы тост ошибки на каждом DnD задачи (#632).
 *  Маршрут проверяется настоящим MSW: опечатка в пути всплывает иначе только
 *  в демо-сборке (необработанный запрос уходит в сеть и даёт 404). */
const server = setupServer(...tasksHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeAll(() => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: null,
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'admin@nodus.by',
      displayName: 'Администратор Системный',
      permissions: [Permission.PROJECT_MANAGE, Permission.PROJECT_VIEW_SECRET],
    },
  });
});

describe('мок move-preview задачи (#632)', () => {
  it('пустой дифф на любой узел — окно подтверждения не открывается', async () => {
    const res = await fetch(`/api/v1/tasks/${demoTasks[0]!.id}/move-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: null }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ changes: [] });
  });
});
