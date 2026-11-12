import type { ProjectGroup, ProjectListItem, ProjectPortfolioCount } from '@nodus/contracts';

/** Данные страницы журнала проектов (#559) для компонентных тестов: папки,
 *  счётчики и строки таблицы. Моки хуков — в самих тестах (vi.mock). */
export const ME = '20000000-0000-4000-8000-000000000001';

export const PORTFOLIO: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
  archivedAt: null,
};
export const ARCHIVED_PORTFOLIO: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000002',
  name: 'Старый объект',
  archivedAt: '2026-11-01T10:00:00.000Z',
};
export const GROUPS: ProjectGroup[] = [PORTFOLIO, ARCHIVED_PORTFOLIO];

export const COUNTS: ProjectPortfolioCount[] = [
  { portfolioId: PORTFOLIO.id, active: 98, completed: 2, archived: 0 },
  { portfolioId: ARCHIVED_PORTFOLIO.id, active: 0, completed: 1, archived: 0 },
  { portfolioId: null, active: 4, completed: 1, archived: 2 },
];

const ME_REF = { id: ME, displayName: 'Я Первый', avatarUrl: null };

export function project(overrides: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    code: 'НН-1',
    name: 'Договор на площадку',
    color: 'blue',
    manager: ME_REF,
    assistants: [],
    myMembership: { manager: true, assistant: false, participant: false, observer: false },
    visibility: 'open',
    status: 'active',
    type: null,
    portfolio: { id: PORTFOLIO.id, name: PORTFOLIO.name },
    client: null,
    membersCount: 1,
    membersPreview: [ME_REF],
    endDate: null,
    activityAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

export const ACTIVE_PROJECT = project();
export const ARCHIVED_PROJECT = project({
  id: '10000000-0000-4000-8000-000000000002',
  name: 'Архивный договор',
  status: 'archived',
  portfolio: { id: ARCHIVED_PORTFOLIO.id, name: ARCHIVED_PORTFOLIO.name },
});

/** Ответ `useProjectsJournal` в форме TanStack InfiniteData. */
export function journalData(items: ProjectListItem[]) {
  return {
    data: { pages: [{ items, nextCursor: null }], pageParams: [null] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => undefined,
  };
}
