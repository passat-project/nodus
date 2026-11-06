// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type {
  ProjectDetail,
  ProjectGroup,
  ProjectListItem,
  ProjectType,
  UserRef,
} from '@nodus/contracts';
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { useProjectStatus, useTransferProject } from './project-mutations.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { usersListKey } from '../../../shared/api/users-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import type { JournalPages } from './project-mutation-helpers.js';

/** Мутации проектов (#52, #631), часть 2: метки статусов (Т6) и передача
 *  руководства (Т5). Вынесено из project-mutations.test.tsx (лимит строк
 *  файла); фикстуры и хелперы продублированы. */
const server = setupServer();

const ME = '20000000-0000-4000-8000-000000000001';
const ASSISTANT = '20000000-0000-4000-8000-000000000002';
const NEW_MANAGER = '20000000-0000-4000-8000-000000000003';
const OTHER_MEMBER = '20000000-0000-4000-8000-000000000004';
const TYPE_ID = '00000000-0000-4000-8000-0000000000t1';
const PORTFOLIO_ID = '00000000-0000-4000-8000-0000000000g1';

function userRef(id: string, name: string): UserRef {
  return { id, displayName: name, avatarUrl: null };
}

const ME_REF = userRef(ME, 'Я Первый');

function listItem(extra: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    code: null,
    name: 'Школа в Микрорайоне',
    color: 'blue',
    manager: ME_REF,
    assistants: [userRef(ASSISTANT, 'Помощник')],
    myMembership: { manager: true, assistant: false, participant: false, observer: false },
    visibility: 'open',
    status: 'active',
    type: { id: TYPE_ID, name: 'Договор' },
    portfolio: null,
    client: null,
    membersCount: 2,
    membersPreview: [ME_REF, userRef(ASSISTANT, 'Помощник')],
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
    customFields: { [SYSTEM_FIELD_IDS.projectCode]: 'Ш-100' },
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

function pages(items: ProjectListItem[]): JournalPages {
  return { pages: [{ items, nextCursor: null }], pageParams: [null] };
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function hook<T>(qc: QueryClient, fn: () => T) {
  return renderHook(fn, {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

/** Кэш журнала с фильтрами (key[2] — фильтры журнала) + справочники. */
function seedJournal(
  qc: QueryClient,
  items: ProjectListItem[],
  filters: Record<string, unknown> = { scope: 'all' },
) {
  qc.setQueryData(projectsKeys.journal(filters as never), pages(items));
  qc.setQueryData(usersListKey, {
    items: [
      ME_REF,
      userRef(ASSISTANT, 'Помощник'),
      userRef(NEW_MANAGER, 'Новый'),
      userRef(OTHER_MEMBER, 'Другой'),
    ],
    nextCursor: null,
  });
  qc.setQueryData<ProjectType[]>(projectsKeys.types(), [{ id: TYPE_ID, name: 'Договор' }] as never);
  qc.setQueryData<ProjectGroup[]>(projectsKeys.groups(), [
    { id: PORTFOLIO_ID, name: 'Брестская область' },
  ] as never);
}

beforeAll(() => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-token',
    user: {
      id: ME,
      email: 'me@nodus.by',
      displayName: 'Я Первый',
      permissions: [],
      modules: ['projects'],
    },
  });
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('useProjectStatus: метки статусов (Т6)', () => {
  const ID = '10000000-0000-4000-8000-000000000001';

  it('завершение помечает completedAt, архив — archivedAt (оптимистично)', async () => {
    server.use(
      http.post('/api/v1/projects/:id/status', () =>
        HttpResponse.json(detail({ id: ID, status: 'completed' })),
      ),
    );

    const qc = makeClient();
    seedJournal(qc, [listItem()]);
    qc.setQueryData(projectsKeys.detail(ID), detail());

    const { result } = hook(qc, () => useProjectStatus());
    result.current.mutate({ id: ID, status: 'completed' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Успех заменяет оптимизм серверным DTO.
    expect(qc.getQueryData<ProjectDetail>(projectsKeys.detail(ID))?.status).toBe('completed');
    expect(
      qc.getQueryData<JournalPages>(projectsKeys.journal({ scope: 'all' } as never))?.pages[0]
        ?.items[0]?.status,
    ).toBe('completed');
  });

  it('оптимистично: completedAt/archivedAt проставляются до ответа', async () => {
    let resolveStatus!: (project: ProjectDetail) => void;
    server.use(
      http.post('/api/v1/projects/:id/status', () =>
        new Promise<ProjectDetail>((resolve) => {
          resolveStatus = resolve;
        }).then((project) => HttpResponse.json(project)),
      ),
    );

    const qc = makeClient();
    seedJournal(qc, [listItem()]);
    qc.setQueryData(projectsKeys.detail(ID), detail());

    const { result } = hook(qc, () => useProjectStatus());
    result.current.mutate({ id: ID, status: 'archived' });

    await waitFor(() => {
      expect(qc.getQueryData<ProjectDetail>(projectsKeys.detail(ID))?.status).toBe('archived');
    });
    const pending = qc.getQueryData<ProjectDetail>(projectsKeys.detail(ID))!;
    expect(pending.archivedAt).not.toBeNull();
    expect(pending.completedAt).toBeNull();

    resolveStatus(detail({ id: ID, status: 'archived' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useTransferProject: передача руководства (Т5)', () => {
  const ID = '10000000-0000-4000-8000-000000000001';

  it('руководитель заменяется, он же уходит из помощников (оптимистично)', async () => {
    server.use(
      http.post('/api/v1/projects/:id/transfer', () =>
        HttpResponse.json(
          detail({
            id: ID,
            manager: userRef(NEW_MANAGER, 'Новый'),
            assistants: [userRef(OTHER_MEMBER, 'Другой')],
          }),
        ),
      ),
    );

    const qc = makeClient();
    seedJournal(qc, [
      listItem({ assistants: [userRef(NEW_MANAGER, 'Новый'), userRef(OTHER_MEMBER, 'Другой')] }),
    ]);
    qc.setQueryData(
      projectsKeys.detail(ID),
      detail({ assistants: [userRef(NEW_MANAGER, 'Новый'), userRef(OTHER_MEMBER, 'Другой')] }),
    );

    const { result } = hook(qc, () => useTransferProject(ID));
    result.current.mutate({ managerId: NEW_MANAGER, manager: userRef(NEW_MANAGER, 'Новый') });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const journalRow = qc.getQueryData<JournalPages>(
      projectsKeys.journal({ scope: 'all' } as never),
    )!.pages[0]!.items[0]!;
    expect(journalRow.manager?.id).toBe(NEW_MANAGER);
    expect(journalRow.assistants.map((a) => a.id)).toEqual([OTHER_MEMBER]);
  });
});
