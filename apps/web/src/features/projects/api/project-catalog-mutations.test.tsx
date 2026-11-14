// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectGroup } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  useArchiveProjectGroup,
  useCreateProjectGroup,
  useRenameProjectGroup,
  useRestoreProjectGroup,
} from './project-catalog-mutations.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';

/** Мутации папок-портфелей журнала (#559): создание/переименование/архив/
 *  возврат — оптимистично (I4) и с откатом при ошибке сервера. */
const server = setupServer();

const ME = '20000000-0000-4000-8000-000000000001';
const METRO: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
  archivedAt: null,
};

function makeClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(projectsKeys.groups(false), [METRO]);
  qc.setQueryData(projectsKeys.groups(true), [METRO]);
  return qc;
}

function hook<T>(qc: QueryClient, fn: () => T) {
  return renderHook(fn, {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

function names(qc: QueryClient, includeArchived: boolean): string[] {
  return (qc.getQueryData<ProjectGroup[]>(projectsKeys.groups(includeArchived)) ?? []).map(
    (group) => group.name,
  );
}

beforeAll(() => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-token',
    user: { id: ME, email: 'me@nodus.by', displayName: 'Я Первый', permissions: [], modules: [] },
  });
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useCreateProjectGroup (#559)', () => {
  it('папка появляется в обоих списках до ответа и заменяется серверной', async () => {
    let resolvePost!: (group: ProjectGroup) => void;
    server.use(
      http.post('/api/v1/projects/groups', () =>
        new Promise<ProjectGroup>((resolve) => {
          resolvePost = resolve;
        }).then((group) => HttpResponse.json(group, { status: 201 })),
      ),
    );
    const qc = makeClient();
    const { result } = hook(qc, () => useCreateProjectGroup());

    result.current.mutate('Нежин-Недра 2');

    await waitFor(() => expect(names(qc, true)).toContain('Нежин-Недра 2'));
    expect(names(qc, false)).toContain('Нежин-Недра 2');

    resolvePost({
      id: '42000000-0000-4000-8000-0000000000ff',
      name: 'Нежин-Недра 2',
      archivedAt: null,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const created = qc.getQueryData<ProjectGroup[]>(projectsKeys.groups(true))?.[1];
    expect(created?.id).toBe('42000000-0000-4000-8000-0000000000ff');
  });

  it('ошибка создания — временная строка убрана', async () => {
    server.use(
      http.post('/api/v1/projects/groups', () =>
        HttpResponse.json({ code: 'FORBIDDEN', message: 'no' }, { status: 403 }),
      ),
    );
    const qc = makeClient();
    const { result } = hook(qc, () => useCreateProjectGroup());

    result.current.mutate('Чужой портфель');
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(names(qc, true)).not.toContain('Чужой портфель');
  });
});

describe('useRenameProjectGroup (#559)', () => {
  it('имя меняется оптимистично и откатывается при отказе', async () => {
    server.use(
      http.patch('/api/v1/projects/groups/:id', () =>
        HttpResponse.json({ code: 'FORBIDDEN', message: 'no' }, { status: 403 }),
      ),
    );
    const qc = makeClient();
    const { result } = hook(qc, () => useRenameProjectGroup());

    result.current.mutate({ id: METRO.id, name: 'Нежин-Недра (новый)' });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(names(qc, true)).toEqual(['Нежин-Недра']);
    expect(names(qc, false)).toEqual(['Нежин-Недра']);
  });

  it('успех — новое имя в списках', async () => {
    server.use(
      http.patch('/api/v1/projects/groups/:id', () =>
        HttpResponse.json({ ...METRO, name: 'Нежин-Недра (новый)' }),
      ),
    );
    const qc = makeClient();
    const { result } = hook(qc, () => useRenameProjectGroup());

    result.current.mutate({ id: METRO.id, name: 'Нежин-Недра (новый)' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(names(qc, true)).toEqual(['Нежин-Недра (новый)']);
  });
});

describe('архив и возврат портфеля (#559)', () => {
  it('архив ставит метку оптимистично', async () => {
    let resolveDelete!: (group: ProjectGroup) => void;
    server.use(
      http.delete('/api/v1/projects/groups/:id', () =>
        new Promise<ProjectGroup>((resolve) => {
          resolveDelete = resolve;
        }).then((group) => HttpResponse.json(group)),
      ),
    );
    const qc = makeClient();
    const { result } = hook(qc, () => useArchiveProjectGroup());

    result.current.mutate(METRO.id);
    await waitFor(() =>
      expect(
        qc.getQueryData<ProjectGroup[]>(projectsKeys.groups(true))?.[0]?.archivedAt,
      ).not.toBeNull(),
    );

    resolveDelete({ ...METRO, archivedAt: '2026-11-12T10:00:00.000Z' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('отказ архива — папка снова живая', async () => {
    server.use(
      http.delete('/api/v1/projects/groups/:id', () =>
        HttpResponse.json({ code: 'FORBIDDEN', message: 'no' }, { status: 403 }),
      ),
    );
    const qc = makeClient();
    const { result } = hook(qc, () => useArchiveProjectGroup());

    result.current.mutate(METRO.id);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<ProjectGroup[]>(projectsKeys.groups(true))?.[0]?.archivedAt).toBeNull();
  });

  it('возврат из архива снимает метку', async () => {
    server.use(http.post('/api/v1/projects/groups/:id/restore', () => HttpResponse.json(METRO)));
    const qc = makeClient();
    qc.setQueryData(projectsKeys.groups(true), [
      { ...METRO, archivedAt: '2026-11-01T10:00:00.000Z' },
    ]);
    const { result } = hook(qc, () => useRestoreProjectGroup());

    result.current.mutate(METRO.id);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData<ProjectGroup[]>(projectsKeys.groups(true))?.[0]?.archivedAt).toBeNull();
  });

  it('отказ возврата — папка снова в архиве (откат снапшота)', async () => {
    server.use(
      http.post('/api/v1/projects/groups/:id/restore', () =>
        HttpResponse.json({ code: 'FORBIDDEN', message: 'no' }, { status: 403 }),
      ),
    );
    const qc = makeClient();
    const archived = { ...METRO, archivedAt: '2026-11-01T10:00:00.000Z' };
    qc.setQueryData(projectsKeys.groups(true), [archived]);
    qc.setQueryData(projectsKeys.groups(false), []);
    const { result } = hook(qc, () => useRestoreProjectGroup());

    result.current.mutate(METRO.id);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(qc.getQueryData<ProjectGroup[]>(projectsKeys.groups(true))?.[0]?.archivedAt).toBe(
      archived.archivedAt,
    );
  });
});
