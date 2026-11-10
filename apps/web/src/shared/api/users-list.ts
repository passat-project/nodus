import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PAGINATION_MAX_LIMIT } from '@nodus/contracts';
import type { Paginated, UserListItem } from '@nodus/contracts';

import { api } from '../api-client.js';

/** Справочник людей — ОДИН запрос на продукт, ключ shared (потребители:
 *  журнал сотрудников, фильтры и пикеры задач/проектов, палитра Ctrl+K).
 *  Ключ совпадает с directoryKeys.users() — общий кэш. */
export const usersListKey = ['directory', 'users'] as const;

/** Поверхность серверного поиска людей: у каждой свой лимит/фильтр запроса,
 *  поэтому кэши поверхностей раздельны (один q ≠ один ответ). */
export type UsersSearchScope = 'search' | 'add-members' | 'mention-autocomplete';

/** Фабрика ключей справочника людей (канон patterns.md: ключи только через
 *  factory). Все ключи — под базовым usersListKey: инвалидация справочника
 *  префиксом задевает и полный список, и поиски поверхностей. */
export const usersKeys = {
  all: usersListKey,
  search: (scope: UsersSearchScope, q: string) => [...usersListKey, scope, q] as const,
};

/** Предохранитель цикла добора: 50 страниц × 100 = 5000 человек — на порядок
 *  выше штата; сервер, вернувший «вечный» курсор, не повесит вкладку. */
const USERS_MAX_PAGES = 50;

/** Весь справочник постранично (limit=100, цикл по nextCursor): потребители
 *  читают `items` как полный список, nextCursor результата — всегда null. */
export async function fetchAllUsers(): Promise<Paginated<UserListItem>> {
  const items: UserListItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < USERS_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(PAGINATION_MAX_LIMIT) });
    if (cursor) params.set('cursor', cursor);
    const result: Paginated<UserListItem> = await api<Paginated<UserListItem>>(
      `/directory/users?${params}`,
    );
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return { items, nextCursor: null };
}

/** Поиск активных сотрудников для пикеров (серверный фильтр по ФИО/email —
 *  живой ввод не фильтрует полный справочник на каждый символ); пустой
 *  запрос — первая страница справочника. */
export function useUsersSearch(search: string) {
  const q = search.trim();
  return useQuery({
    queryKey: usersKeys.search('search', q),
    queryFn: () =>
      api<Paginated<UserListItem>>(
        `/directory/users?status=active&limit=30${q ? `&search=${encodeURIComponent(q)}` : ''}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/** Справочник ЦЕЛИКОМ на клиенте (~170 человек — канон «малый справочник
 *  целиком»): добор всех страниц внутри queryFn, иначе журнал сотрудников,
 *  пикеры и фильтры молча теряли людей за первой страницей. */
export function useUsersList(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: usersListKey,
    queryFn: fetchAllUsers,
    enabled: options.enabled ?? true,
  });
}
