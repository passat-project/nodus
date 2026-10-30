// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DepartmentNode } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { flattenDepartments, useDepartmentTreeManagement } from './departments-list.js';

/**
 * Регрессия #540: веб звал /directory/departments без /tree, API отвечал 404
 * на каждом входе. MSW-мок слушал тот же неверный путь и маскировал дефект —
 * здесь handler стоит ТОЛЬКО на реальном контракте, а onUnhandledRequest
 * роняет тест, если запрос снова уйдёт на /departments.
 */
const server = setupServer();

const node: DepartmentNode = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Управление',
  kind: 'management',
  parentId: null,
  headId: null,
  deputyId: null,
  sortOrder: 0,
  isActive: true,
  headName: null,
  deputyName: null,
  memberCount: 1,
  children: [],
};

function hook<T>(use: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(use, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('дерево подразделений: контракт /tree (#540)', () => {
  it('useDepartmentTreeManagement запрашивает /directory/departments/tree', async () => {
    let requested = '';
    server.use(
      http.get('/api/v1/directory/departments/tree', ({ request }) => {
        const url = new URL(request.url);
        requested = `${url.pathname}${url.search}`;
        return HttpResponse.json([node]);
      }),
    );
    server.listen({ onUnhandledRequest: 'error' });

    const { result } = hook(() => useDepartmentTreeManagement());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(requested).toBe('/api/v1/directory/departments/tree?kind=management');
    expect(result.current.data?.map((item) => item.name)).toEqual(['Управление']);
    server.close();
  });

  it('flattenDepartments разворачивает дерево с глубиной', () => {
    const child: DepartmentNode = {
      ...node,
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Отдел',
      parentId: node.id,
    };
    expect(flattenDepartments([{ ...node, children: [child] }])).toEqual([
      { id: node.id, name: 'Управление', depth: 0, isActive: true },
      { id: child.id, name: 'Отдел', depth: 1, isActive: true },
    ]);
  });
});
