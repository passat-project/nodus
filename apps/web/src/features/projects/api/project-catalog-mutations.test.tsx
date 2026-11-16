// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectGroup } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  useCreateProjectGroup,
  useDeleteProjectGroup,
  useRenameProjectGroup,
} from './project-catalog-mutations.js';
import { JOURNAL_PREFIX, type JournalPages } from './project-mutation-helpers.js';
import { ACTIVE_PROJECT } from '../fixtures/journal.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';

/** Мутации папок-портфелей журнала (#559): создание/переименование/удаление —
 *  оптимистично (I4) и с откатом при ошибке сервера. Архива у папки нет
 *  (13.11.2026): удаление сразу навсегда. */
const server = setupServer();

const ME = '20000000-0000-4000-8000-000000000001';
const METRO: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
};

function makeClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(projectsKeys.groups(), [METRO]);
  return qc;
}

function hook<T>(qc: QueryClient, fn: () => T) {
  return renderHook(fn, {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

function names(qc: QueryClient): string[] {
  return (qc.getQueryData<ProjectGroup[]>(projectsKeys.groups()) ?? []).map((group) => group.name);
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
  it('папка появляется в списке до ответа и заменяется серверной', async () => {
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

    await waitFor(() => expect(names(qc)).toContain('Нежин-Недра 2'));

    resolvePost({
      id: '42000000-0000-4000-8000-0000000000ff',
      name: 'Нежин-Недра 2',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const created = qc.getQueryData<ProjectGroup[]>(projectsKeys.groups())?.[1];
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

    expect(names(qc)).not.toContain('Чужой портфель');
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

    expect(names(qc)).toEqual(['Нежин-Недра']);
  });

  it('успех — новое имя в списке', async () => {
    server.use(
      http.patch('/api/v1/projects/groups/:id', () =>
        HttpResponse.json({ ...METRO, name: 'Нежин-Недра (новый)' }),
      ),
    );
    const qc = makeClient();
    const { result } = hook(qc, () => useRenameProjectGroup());

    result.current.mutate({ id: METRO.id, name: 'Нежин-Недра (новый)' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(names(qc)).toEqual(['Нежин-Недра (новый)']);
  });
});

describe('useDeleteProjectGroup (#559)', () => {
  /** Журнал с проектом, который лежит в удаляемой папке. */
  function seedJournal(qc: QueryClient) {
    qc.setQueryData<JournalPages>(JOURNAL_PREFIX, {
      pages: [{ items: [ACTIVE_PROJECT], nextCursor: null }],
      pageParams: [null],
    });
  }
  const journalItem = (qc: QueryClient) =>
    qc.getQueryData<JournalPages>(JOURNAL_PREFIX)?.pages[0]?.items[0];

  it('удаление: папка исчезает, проекты — в «Без портфеля» (оптимистично, до ответа)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.delete('/api/v1/projects/groups/:id/permanent', async () => {
        await gate;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const qc = makeClient();
    seedJournal(qc);
    const { result } = hook(qc, () => useDeleteProjectGroup());

    result.current.mutate(METRO.id);

    await waitFor(() => expect(names(qc)).toEqual([]));
    expect(journalItem(qc)?.portfolio).toBeNull();

    release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(journalItem(qc)?.id).toBe(ACTIVE_PROJECT.id);
  });

  it('отказ удаления — папка и портфель проекта возвращаются (откат снапшота)', async () => {
    server.use(
      http.delete('/api/v1/projects/groups/:id/permanent', () =>
        HttpResponse.json({ code: 'FORBIDDEN', message: 'no' }, { status: 403 }),
      ),
    );
    const qc = makeClient();
    seedJournal(qc);
    const { result } = hook(qc, () => useDeleteProjectGroup());

    result.current.mutate(METRO.id);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(names(qc)).toEqual([METRO.name]);
    expect(journalItem(qc)?.portfolio?.id).toBe(METRO.id);
  });
});
