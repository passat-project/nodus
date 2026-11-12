import { useQuery } from '@tanstack/react-query';
import type { Paginated, ProjectGroup, ProjectListItem, ProjectType } from '@nodus/contracts';
import { PAGINATION_MAX_LIMIT } from '@nodus/contracts';

import { api } from '../api-client.js';

/**
 * Справочники модуля проектов — shared (потребители: журнал, фильтры задач и
 * писем, палитра Ctrl+K, пикеры форм, атрибуты-проекты). Ключи под общим
 * префиксом `projects` — инвалидации модуля достают всё.
 */
export const projectsKeys = {
  all: ['projects'] as const,
  /** Полный видимый справочник для пикеров/фильтров (не журнал). */
  options: () => [...projectsKeys.all, 'options'] as const,
  types: (includeArchived = false) => [...projectsKeys.all, 'types', includeArchived] as const,
  groups: (includeArchived = false) => [...projectsKeys.all, 'groups', includeArchived] as const,
  journal: (params: Record<string, string | undefined>) =>
    [...projectsKeys.all, 'journal', params] as const,
  /** Префикс всех журналов: событие проекта перечитывает любой фильтр. */
  journals: () => [...projectsKeys.all, 'journal'] as const,
  detail: (id: string) => [...projectsKeys.all, 'detail', id] as const,
  members: (id: string) => [...projectsKeys.all, 'members', id] as const,
  history: (id: string) => [...projectsKeys.all, 'history', id] as const,
  /** Дерево структуры проекта (#467): узлы + виды узлов. */
  structure: (id: string) => [...projectsKeys.all, 'structure', id] as const,
  /** Префикс всех деревьев: агрегаты узлов зависят от задач проекта (#467). */
  structures: () => [...projectsKeys.all, 'structure'] as const,
};

/** Предохранитель добора: 10 × 100 = 1000 проектов — выше штата портала. */
const PROJECTS_MAX_PAGES = 10;

/** Видимый справочник целиком (scope=all: открытые + секретные моего
 *  участия): пикеры и фильтры не должны терять проекты за первой страницей. */
export async function fetchAllProjects(): Promise<Paginated<ProjectListItem>> {
  const items: ProjectListItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < PROJECTS_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      scope: 'all',
      limit: String(PAGINATION_MAX_LIMIT),
    });
    if (cursor) params.set('cursor', cursor);
    const result = await api<Paginated<ProjectListItem>>(`/projects?${params}`);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return { items, nextCursor: null };
}

export function useProjectsList(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: projectsKeys.options(),
    queryFn: fetchAllProjects,
    enabled: options.enabled ?? true,
  });
}

/** Каталог типов проектов (создание проекта; архивные — по флагу). */
export function useProjectTypes(includeArchived = false) {
  return useQuery({
    queryKey: projectsKeys.types(includeArchived),
    queryFn: () =>
      api<ProjectType[]>(`/projects/types?includeArchived=${includeArchived ? 'true' : 'false'}`),
  });
}

/** Портфели (плоский список; фильтр журнала, поле формы). */
export function useProjectGroups(includeArchived = false) {
  return useQuery({
    queryKey: projectsKeys.groups(includeArchived),
    queryFn: () =>
      api<ProjectGroup[]>(`/projects/groups?includeArchived=${includeArchived ? 'true' : 'false'}`),
  });
}
