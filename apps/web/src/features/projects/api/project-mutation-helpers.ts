import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type {
  Paginated,
  ProjectDetail,
  ProjectListItem,
  ProjectMember,
  UserRef,
} from '@nodus/contracts';

import { projectsKeys } from '../../../shared/api/projects-list.js';
import { usersListKey } from '../../../shared/api/users-list.js';

export type JournalPages = InfiniteData<Paginated<ProjectListItem>, string | null>;
export type MemberPages = InfiniteData<Paginated<ProjectMember>, string | null>;

export const JOURNAL_PREFIX = [...projectsKeys.all, 'journal'] as const;

/** Ссылка сотрудника из кэша справочника (пикеры его уже загрузили). */
export function userRefOf(
  id: string,
  users: readonly { id: string; displayName: string; avatarUrl: string | null }[],
): UserRef {
  const found = users.find((user) => user.id === id);
  return found
    ? { id: found.id, displayName: found.displayName, avatarUrl: found.avatarUrl }
    : { id, displayName: '', avatarUrl: null };
}

/** Патч строки проекта во всех журналах, справочнике и карточке. */
export function replaceInJournal(
  queryClient: QueryClient,
  id: string,
  patch: Partial<ProjectListItem>,
): void {
  queryClient.setQueriesData<JournalPages>({ queryKey: JOURNAL_PREFIX }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((row) => (row.id === id ? { ...row, ...patch } : row)),
          })),
        }
      : data,
  );
  queryClient.setQueryData<Paginated<ProjectListItem>>(projectsKeys.options(), (data) =>
    data
      ? { ...data, items: data.items.map((row) => (row.id === id ? { ...row, ...patch } : row)) }
      : data,
  );
  queryClient.setQueryData<ProjectDetail>(projectsKeys.detail(id), (data) =>
    data ? { ...data, ...patch } : data,
  );
}

/**
 * Удаление портфеля: у всех проектов папки в кэшах журнала/справочника
 * портфель становится «Без портфеля» — строки не исчезают (оптимистично, I4).
 */
export function stripPortfolioFromJournal(queryClient: QueryClient, portfolioId: string): void {
  const strip = (item: ProjectListItem): ProjectListItem =>
    item.portfolio?.id === portfolioId ? { ...item, portfolio: null } : item;
  queryClient.setQueriesData<JournalPages>({ queryKey: JOURNAL_PREFIX }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({ ...page, items: page.items.map(strip) })),
        }
      : data,
  );
  queryClient.setQueryData<Paginated<ProjectListItem>>(projectsKeys.options(), (data) =>
    data ? { ...data, items: data.items.map(strip) } : data,
  );
}

/** Патч первой страницы состава (оптимистичные join/leave/добавления). */
export function patchMemberPages(
  queryClient: QueryClient,
  projectId: string,
  update: (items: ProjectMember[]) => ProjectMember[],
): void {
  queryClient.setQueryData<MemberPages>(projectsKeys.members(projectId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page, index) =>
            index === 0 ? { ...page, items: update(page.items) } : page,
          ),
        }
      : data,
  );
}

/** Кэш справочника сотрудников (полный список пикеров/фильтров). */
export function cachedUsers(queryClient: QueryClient) {
  return (
    queryClient.getQueryData<
      Paginated<{ id: string; displayName: string; avatarUrl: string | null }>
    >(usersListKey)?.items ?? []
  );
}
