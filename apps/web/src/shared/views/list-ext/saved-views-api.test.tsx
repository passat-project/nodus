// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { SavedView } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  savedViewsKeys,
  useCreateSavedView,
  useDeleteSavedView,
  useJournalSavedViews,
  useProjectSavedViews,
  useUpdateSavedView,
} from './saved-views-api.js';

/** Хуки сохранённых настроек списков (#435): рамки чтения (журнал/проект),
 * мутации и инвалидация общего ключа после каждой. */
const server = setupServer();

const P1 = '00000000-0000-4000-8000-0000000000p1';
const U1 = '00000000-0000-4000-8000-0000000000u1';

function makeView(partial: Partial<SavedView> = {}): SavedView {
  return {
    id: '00000000-0000-4000-8000-0000000000v1',
    name: 'Переработки',
    entity: 'task',
    scope: { kind: 'journal' },
    level: 'personal',
    filter: [],
    sort: [],
    totals: [],
    columns: [{ field: 'number' }],
    createdAt: '2026-11-28T00:00:00.000Z',
    createdBy: U1,
    ...partial,
  };
}

function hook<T>(client: QueryClient, render: () => T) {
  return renderHook(render, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('saved-views-api (#435)', () => {
  afterEach(() => server.close());

  it('журнальная рамка: entity подмешивается в запрос', async () => {
    let calledWith = '';
    server.use(
      http.get('/api/v1/views', ({ request }) => {
        calledWith = request.url;
        return HttpResponse.json([makeView()]);
      }),
    );
    server.listen({ onUnhandledRequest: 'error' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = hook(client, () => useJournalSavedViews('task'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledWith).toContain('journal=true');
    expect(calledWith).toContain('entity=task');
    expect(result.current.data?.[0]?.name).toBe('Переработки');
  });

  it('рамка проекта: GET /views?projectId=', async () => {
    server.use(
      http.get('/api/v1/views', () =>
        HttpResponse.json([makeView({ scope: { kind: 'project', projectId: P1 } })]),
      ),
    );
    server.listen({ onUnhandledRequest: 'error' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = hook(client, () => useProjectSavedViews(P1));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.scope.kind).toBe('project');
  });

  it('создание: ответ ложится в журнальную рамку и инвалидирует всё', async () => {
    const created = makeView({ id: '00000000-0000-4000-8000-0000000000v2', name: 'Новая' });
    server.use(http.post('/api/v1/views', () => HttpResponse.json(created, { status: 201 })));
    server.listen({ onUnhandledRequest: 'error' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Живая рамка в кэше: после мутации обязана стать invalid (перечитается).
    client.setQueryData<SavedView[]>(savedViewsKeys.journal('task'), [makeView()]);
    const frame = () => client.getQueryCache().find({ queryKey: savedViewsKeys.journal('task') })!;
    expect(frame().state.isInvalidated).toBe(false);
    const { result } = hook(client, () => useCreateSavedView());
    result.current.mutate({
      name: 'Новая',
      entity: 'task',
      scope: { kind: 'journal' },
      filter: [],
      sort: [],
      totals: [],
      columns: [],
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData<SavedView[]>(savedViewsKeys.journal())).toEqual([created]);
    await waitFor(() => expect(frame().state.isInvalidated).toBe(true));
  });

  it('удаление и правка инвалидируют рамку', async () => {
    server.use(
      http.delete('/api/v1/views/:id', () => new HttpResponse(null, { status: 204 })),
      http.patch('/api/v1/views/:id', () => HttpResponse.json(makeView({ name: 'v2' }))),
    );
    server.listen({ onUnhandledRequest: 'error' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const frameOf = () => {
      client.setQueryData<SavedView[]>(savedViewsKeys.project(P1), [makeView()]);
      return () => client.getQueryCache().find({ queryKey: savedViewsKeys.project(P1) })!;
    };
    const frame = frameOf();

    const del = hook(client, () => useDeleteSavedView());
    del.result.current.mutate('00000000-0000-4000-8000-0000000000v1');
    await waitFor(() => expect(del.result.current.isSuccess).toBe(true));
    expect(frame().state.isInvalidated).toBe(true);

    // Правка: свежая (не invalid) рамка снова помечается перечиткой.
    frameOf();
    const upd = hook(client, () => useUpdateSavedView());
    upd.result.current.mutate({
      id: '00000000-0000-4000-8000-0000000000v1',
      body: { name: 'v2', filter: [{ kind: 'system_state', state: 'closed' }] },
    });
    await waitFor(() => expect(upd.result.current.isSuccess).toBe(true));
    expect(frame().state.isInvalidated).toBe(true);
  });
});
