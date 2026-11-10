// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { useAddTaskParticipant, useSetTaskAssignee } from './participants-api.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const secretError = {
  code: 'PROJECT_TASK_MEMBERS_INVALID',
  message: 'fail',
  details: { projectId: 'p-1', userIds: ['u-1'] },
};

describe('ошибка состава секретного проекта в карточке (#674)', () => {
  it('добавление соисполнителя: имя в тосте, userName не уходит в API', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/tasks/t-1/participants', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(secretError, { status: 422 });
      }),
    );
    const { result } = renderHook(() => useAddTaskParticipant('t-1'), {
      wrapper: wrapperFor(makeClient()),
    });

    act(() => {
      result.current.mutate({ userId: 'u-1', role: 'coexecutor', userName: 'Иванов И.' });
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(`${ui.projects.secretMembersNoAccess}: Иванов И.`),
    );
    expect(body).toEqual({ userId: 'u-1', role: 'coexecutor' });
  });

  it('смена ответственного: имя в тосте, userName не уходит в API', async () => {
    let body: unknown;
    server.use(
      http.patch('/api/v1/tasks/t-1', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(secretError, { status: 422 });
      }),
    );
    const { result } = renderHook(() => useSetTaskAssignee('t-1'), {
      wrapper: wrapperFor(makeClient()),
    });

    act(() => {
      result.current.mutate({ assigneeId: 'u-1', userName: 'Иванов И.' });
    });

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(`${ui.projects.secretMembersNoAccess}: Иванов И.`),
    );
    expect(body).toEqual({ assigneeId: 'u-1' });
  });
});
