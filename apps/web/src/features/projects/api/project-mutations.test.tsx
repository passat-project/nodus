// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type {
  CounterpartyRef,
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

import { useCreateProject, useUpdateProject } from './project-mutations.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { usersListKey } from '../../../shared/api/users-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import type { JournalPages } from './project-mutation-helpers.js';

/** Мутации проектов (#52, #631): оптимистичные вставка/патчи журнала и
 *  карточки (I4) — шифр и заказчик едут значениями атрибутов, витринная
 *  строка журнала — производная; откат при ошибке сервера. Статусы (Т6) и
 *  передача руководства (Т5) — project-mutations.status.test.tsx. */
const server = setupServer();

const ME = '20000000-0000-4000-8000-000000000001';
const ASSISTANT = '20000000-0000-4000-8000-000000000002';
const NEW_MANAGER = '20000000-0000-4000-8000-000000000003';
const OTHER_MEMBER = '20000000-0000-4000-8000-000000000004';
const TYPE_ID = '00000000-0000-4000-8000-0000000000t1';
const PORTFOLIO_ID = '00000000-0000-4000-8000-0000000000g1';
const CLIENT_ID = '90000000-0000-4000-8000-000000000001';

function userRef(id: string, name: string): UserRef {
  return { id, displayName: name, avatarUrl: null };
}

const ME_REF = userRef(ME, 'Я Первый');
const CLIENT: CounterpartyRef = { id: CLIENT_ID, name: 'АО «Галургия»' };

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

describe('useCreateProject: оптимистичная вставка журнала (#52, #631)', () => {
  it('временная строка вставляется в подходящий журнал и заменяется серверной', async () => {
    let resolvePost!: (project: ProjectDetail) => void;
    server.use(
      http.post('/api/v1/projects', () =>
        new Promise<ProjectDetail>((resolve) => {
          resolvePost = resolve;
        }).then((project) => HttpResponse.json(project)),
      ),
    );

    const qc = makeClient();
    seedJournal(qc, [listItem({ id: '10000000-0000-4000-8000-000000000099', name: 'Другой' })]);
    const { result } = hook(qc, () => useCreateProject());

    result.current.mutate({
      body: {
        name: 'Детский сад на 340 мест',
        typeId: TYPE_ID,
        portfolioId: PORTFOLIO_ID,
        managerId: ME,
        assistantIds: [ASSISTANT, ASSISTANT, ME],
        customFields: { [SYSTEM_FIELD_IDS.projectCode]: 'Ш-200' },
      },
      client: CLIENT,
    });

    // До ответа сервера: строка сверху первой страницы, шифр — из атрибута,
    // витринный заказчик — из аргумента, дубль помощника и сам руководитель
    // из помощников убраны, портфель и тип — из справочников.
    await waitFor(() => {
      const journal = qc.getQueryData<JournalPages>(
        projectsKeys.journal({ scope: 'all' } as never),
      );
      expect(journal?.pages[0]?.items[0]?.name).toBe('Детский сад на 340 мест');
    });
    const tempRow = qc.getQueryData<JournalPages>(projectsKeys.journal({ scope: 'all' } as never))!
      .pages[0]!.items[0]!;
    expect(tempRow.id.startsWith('temp-')).toBe(true);
    expect(tempRow.code).toBe('Ш-200');
    expect(tempRow.client).toEqual(CLIENT);
    expect(tempRow.assistants).toEqual([userRef(ASSISTANT, 'Помощник')]);
    expect(tempRow.type).toEqual({ id: TYPE_ID, name: 'Договор' });
    expect(tempRow.portfolio).toEqual({ id: PORTFOLIO_ID, name: 'Брестская область' });
    expect(tempRow.membersCount).toBe(2);
    expect(result.current.isPending).toBe(true);

    resolvePost(
      detail({ id: '10000000-0000-4000-8000-0000000000f1', name: 'Детский сад на 340 мест' }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const after = qc.getQueryData<JournalPages>(projectsKeys.journal({ scope: 'all' } as never))!;
    expect(after.pages[0]!.items[0]?.id).toBe('10000000-0000-4000-8000-0000000000f1');
    // Карточка положена в кэш деталью.
    expect(
      qc.getQueryData<ProjectDetail>(projectsKeys.detail('10000000-0000-4000-8000-0000000000f1'))
        ?.name,
    ).toBe('Детский сад на 340 мест');
  });

  it('журнал с чужим фильтром временную строку не получает', async () => {
    server.use(
      http.post('/api/v1/projects', () =>
        HttpResponse.json(detail({ id: '10000000-0000-4000-8000-0000000000f2' })),
      ),
    );

    const qc = makeClient();
    const existing = listItem({ id: '10000000-0000-4000-8000-000000000098', status: 'completed' });
    seedJournal(qc, [existing], { scope: 'all', status: 'completed' });
    const { result } = hook(qc, () => useCreateProject());

    result.current.mutate({ body: { name: 'Новый проект', typeId: TYPE_ID } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Новый активный не подходит фильтру завершённых — вставки не было.
    const journal = qc.getQueryData<JournalPages>(
      projectsKeys.journal({ scope: 'all', status: 'completed' } as never),
    )!;
    expect(journal.pages[0]!.items.map((row) => row.id)).toEqual([existing.id]);
  });

  it('ошибка — откат снапшота журнала', async () => {
    server.use(
      http.post('/api/v1/projects', () =>
        HttpResponse.json({ code: 'VALIDATION_FAILED', message: 'nope' }, { status: 422 }),
      ),
    );

    const qc = makeClient();
    const existing = listItem();
    seedJournal(qc, [existing]);
    const { result } = hook(qc, () => useCreateProject());

    result.current.mutate({ body: { name: 'Не пролезет', typeId: TYPE_ID } });
    await waitFor(() => expect(result.current.isError).toBe(true));

    const journal = qc.getQueryData<JournalPages>(projectsKeys.journal({ scope: 'all' } as never))!;
    expect(journal.pages[0]!.items.map((row) => row.name)).toEqual([existing.name]);
  });
});

describe('useUpdateProject: оптимистичный патч карточки и журнала', () => {
  const ID = '10000000-0000-4000-8000-000000000001';

  it('имя/шифр/заказчик применяются до ответа; null стирает значение атрибута', async () => {
    let resolvePatch!: (project: ProjectDetail) => void;
    server.use(
      http.patch('/api/v1/projects/:id', () =>
        new Promise<ProjectDetail>((resolve) => {
          resolvePatch = resolve;
        }).then((project) => HttpResponse.json(project)),
      ),
    );

    const qc = makeClient();
    const row = listItem({ customFields: undefined } as never);
    seedJournal(qc, [row]);
    qc.setQueryData(projectsKeys.detail(ID), detail());

    const { result } = hook(qc, () => useUpdateProject(ID));
    result.current.mutate({
      body: {
        name: 'Школа-гимназия',
        customFields: {
          [SYSTEM_FIELD_IDS.projectCode]: 'Ш-200',
          '52000000-0000-4000-8000-000000000001': null,
        },
      },
      client: CLIENT,
    });

    await waitFor(() => {
      expect(qc.getQueryData<ProjectDetail>(projectsKeys.detail(ID))?.name).toBe('Школа-гимназия');
    });
    const patchedDetail = qc.getQueryData<ProjectDetail>(projectsKeys.detail(ID))!;
    expect(patchedDetail.customFields).toEqual({ [SYSTEM_FIELD_IDS.projectCode]: 'Ш-200' });
    expect(patchedDetail.code).toBe('Ш-200');
    expect(patchedDetail.client).toEqual(CLIENT);

    const journalRow = qc.getQueryData<JournalPages>(
      projectsKeys.journal({ scope: 'all' } as never),
    )!.pages[0]!.items[0]!;
    expect(journalRow.name).toBe('Школа-гимназия');
    expect(journalRow.code).toBe('Ш-200');
    expect(journalRow.client).toEqual(CLIENT);
    expect(result.current.isPending).toBe(true);

    resolvePatch(detail({ name: 'Школа-гимназия', id: ID }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(qc.getQueryData<ProjectDetail>(projectsKeys.detail(ID))?.name).toBe('Школа-гимназия');
  });

  it('ошибка — откат карточки к снапшоту', async () => {
    server.use(
      http.patch('/api/v1/projects/:id', () =>
        HttpResponse.json({ code: 'VALIDATION_FAILED', message: 'nope' }, { status: 422 }),
      ),
    );

    const qc = makeClient();
    qc.setQueryData(projectsKeys.detail(ID), detail());
    const { result } = hook(qc, () => useUpdateProject(ID));

    result.current.mutate({ body: { name: 'Не пролезет' } });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(qc.getQueryData<ProjectDetail>(projectsKeys.detail(ID))?.name).toBe(
      'Школа в Микрорайоне',
    );
  });
});
