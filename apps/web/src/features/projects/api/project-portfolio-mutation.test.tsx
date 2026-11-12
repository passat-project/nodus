// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDetail, ProjectGroup, ProjectListItem, UserRef } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { useMoveProjectPortfolio } from './project-portfolio-mutation.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import type { JournalPages } from './project-mutation-helpers.js';

/** Смена портфеля перетаскиванием (#559): оптимистичный патч журнала и
 *  откат при ошибке — права проверяет сервер (I8), UI не даёт тащить чужое. */
const server = setupServer();

const ME = '20000000-0000-4000-8000-000000000001';
const PROJECT = '10000000-0000-4000-8000-000000000001';
const METRO: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
  archivedAt: null,
};
const IT: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000002',
  name: 'ИТ-проекты',
  archivedAt: null,
};

const ME_REF: UserRef = { id: ME, displayName: 'Я Первый', avatarUrl: null };

function listItem(extra: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id: PROJECT,
    code: 'НН-1',
    name: 'Договор на площадку',
    color: 'blue',
    manager: ME_REF,
    assistants: [],
    myMembership: { manager: true, assistant: false, participant: false, observer: false },
    visibility: 'open',
    status: 'active',
    type: null,
    portfolio: { id: METRO.id, name: METRO.name },
    client: null,
    membersCount: 1,
    membersPreview: [ME_REF],
    endDate: null,
    activityAt: '2026-11-01T10:00:00.000Z',
    ...extra,
  };
}

function detail(extra: Partial<ProjectDetail> = {}): ProjectDetail {
  const item = listItem();
  return {
    ...item,
    description: '',
    creator: ME_REF,
    observers: [],
    startDate: null,
    completedAt: null,
    archivedAt: null,
    customFields: {},
    customFieldRefs: [],
    access: {
      canManage: true,
      canManageMembers: true,
      canJoin: false,
      canLeave: false,
      canPostToChannel: true,
      canTransfer: true,
    },
    structureSummary: { nodeCount: 0, hasTaskNodes: false },
    createdAt: '2026-11-01T09:00:00.000Z',
    ...extra,
  };
}

const FILTERS = { scope: 'all' };

function makeClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pages: JournalPages = {
    pages: [{ items: [listItem()], nextCursor: null }],
    pageParams: [null],
  };
  qc.setQueryData(projectsKeys.journal(FILTERS as never), pages);
  qc.setQueryData(projectsKeys.groups(true), [METRO, IT]);
  qc.setQueryData(projectsKeys.detail(PROJECT), detail());
  return qc;
}

function hook(qc: QueryClient) {
  return renderHook(() => useMoveProjectPortfolio(), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

function journalRow(qc: QueryClient): ProjectListItem {
  return qc.getQueryData<JournalPages>(projectsKeys.journal(FILTERS as never))!.pages[0]!.items[0]!;
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

describe('useMoveProjectPortfolio (#559)', () => {
  it('до ответа сервера строка журнала уже в новой папке', async () => {
    let resolvePatch!: (project: ProjectDetail) => void;
    server.use(
      http.patch('/api/v1/projects/:id', () =>
        new Promise<ProjectDetail>((resolve) => {
          resolvePatch = resolve;
        }).then((project) => HttpResponse.json(project)),
      ),
    );

    const qc = makeClient();
    const { result } = hook(qc);

    result.current.mutate({ id: PROJECT, portfolioId: IT.id });

    await waitFor(() => expect(journalRow(qc).portfolio?.id).toBe(IT.id));
    expect(journalRow(qc).portfolio?.name).toBe('ИТ-проекты');
    // Карточка проекта тоже получила новый портфель.
    expect(qc.getQueryData<ProjectDetail>(projectsKeys.detail(PROJECT))?.portfolio?.id).toBe(IT.id);

    resolvePatch(detail({ portfolio: { id: IT.id, name: IT.name } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(journalRow(qc).portfolio?.id).toBe(IT.id);
  });

  it('«Без портфеля» — оптимистично portfolio: null', async () => {
    server.use(
      http.patch('/api/v1/projects/:id', () => HttpResponse.json(detail({ portfolio: null }))),
    );
    const qc = makeClient();
    const { result } = hook(qc);

    result.current.mutate({ id: PROJECT, portfolioId: null });
    await waitFor(() => expect(journalRow(qc).portfolio).toBeNull());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(journalRow(qc).portfolio).toBeNull();
  });

  it('отказ сервера (не руководство) — откат к прежней папке', async () => {
    server.use(
      http.patch('/api/v1/projects/:id', () =>
        HttpResponse.json({ code: 'FORBIDDEN', message: 'forbidden' }, { status: 403 }),
      ),
    );
    const qc = makeClient();
    const { result } = hook(qc);

    result.current.mutate({ id: PROJECT, portfolioId: IT.id });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(journalRow(qc).portfolio).toEqual({ id: METRO.id, name: METRO.name });
    expect(qc.getQueryData<ProjectDetail>(projectsKeys.detail(PROJECT))?.portfolio?.id).toBe(
      METRO.id,
    );
  });

  it('цели нет в закэшированном справочнике — оптимистично «без портфеля»', async () => {
    // Папка не загружена (чекпоинт другого фильтра): имя взять неоткуда —
    // строка не должна показывать чужой портфель до ответа сервера.
    let resolvePatch!: (project: ProjectDetail) => void;
    server.use(
      http.patch('/api/v1/projects/:id', () =>
        new Promise<ProjectDetail>((resolve) => {
          resolvePatch = resolve;
        }).then((project) => HttpResponse.json(project)),
      ),
    );
    const qc = makeClient();
    qc.setQueryData(projectsKeys.groups(true), [METRO]);
    const { result } = hook(qc);

    result.current.mutate({ id: PROJECT, portfolioId: IT.id });

    await waitFor(() => expect(journalRow(qc).portfolio).toBeNull());
    resolvePatch(detail({ portfolio: { id: IT.id, name: IT.name } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(journalRow(qc).portfolio?.id).toBe(IT.id);
  });
});
