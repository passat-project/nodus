// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { useAddProjectMembers } from './project-members.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useAddProjectMembers (#674)', () => {
  it('добавляет каждого участником и перечитывает проекты', async () => {
    const calls: { body: unknown }[] = [];
    server.use(
      http.post('/api/v1/projects/p-1/members', async ({ request }) => {
        calls.push({ body: await request.json() });
        return new HttpResponse(null, { status: 201 });
      }),
    );
    const client = makeClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAddProjectMembers('p-1'), {
      wrapper: wrapperFor(client),
    });

    await result.current.mutateAsync(['u-1', 'u-2']);

    expect(calls.map((call) => call.body)).toEqual([
      { userId: 'u-1', kind: 'member' },
      { userId: 'u-2', kind: 'member' },
    ]);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['projects'] }));
  });

  it('ошибка добавления не переходит к следующему сотруднику', async () => {
    let requests = 0;
    server.use(
      http.post('/api/v1/projects/p-1/members', () => {
        requests += 1;
        return HttpResponse.json({ code: 'FORBIDDEN', message: 'nope' }, { status: 403 });
      }),
    );
    const client = makeClient();
    const { result } = renderHook(() => useAddProjectMembers('p-1'), {
      wrapper: wrapperFor(client),
    });

    await expect(result.current.mutateAsync(['u-1', 'u-2'])).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(requests).toBe(1);
  });
});
