// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Permission } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import { useAuthStore } from '../../../../shared/auth-store.js';
// Порядок как в app/mocks-handlers: реестр атрибутов — раньше данных.
import '../../../../shared/custom-fields/mocks/custom-fields-handlers.js';
import { demoNodeRows } from '../../../../shared/mocks/data/project-nodes.js';
import { demoProjectRows } from '../../../../shared/mocks/data/projects.js';
import { canSeeProject } from '../../../../shared/mocks/data/project-views.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { structureNodeHandlers } from './structure-node-handlers.js';

/** Демо-мир: формульных переносов нет — превью папки обязано ответить пустым
 *  диффом, иначе UI показывал бы тост ошибки на каждом переносе (#632).
 *  Маршрут проверяется настоящим MSW: опечатка в пути всплывает иначе только
 *  в демо-сборке (необработанный запрос уходит в сеть и даёт 404). */
const server = setupServer(...structureNodeHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Админ: демо-id генерируются, поэтому проект и папка берутся из данных. */
function asAdmin() {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: null,
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'admin@nodus.by',
      displayName: 'Администратор Системный',
      permissions: [
        Permission.PROJECT_MANAGE,
        Permission.PROJECT_SETUP_MANAGE,
        // Дерево демо-папок живёт в секретном проекте p4 (#632).
        Permission.PROJECT_VIEW_SECRET,
      ],
    },
  });
}

function firstNode(): { projectId: string; nodeId: string } {
  const actor = getMockActor();
  for (const row of demoProjectRows) {
    if (!canSeeProject(row, actor)) continue;
    const node = demoNodeRows.find((entry) => entry.projectId === row.id);
    if (node) return { projectId: row.id, nodeId: node.id };
  }
  throw new Error('в демо-данных нет проекта с папками');
}

describe('мок move-preview папки (#632)', () => {
  it('пустой дифф — окно подтверждения не открывается', async () => {
    asAdmin();
    const { projectId, nodeId } = firstNode();
    const res = await fetch(`/api/v1/projects/${projectId}/nodes/${nodeId}/move-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: null }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ changes: [] });
  });
});
