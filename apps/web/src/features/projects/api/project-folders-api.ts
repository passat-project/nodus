import { useInfiniteQuery } from '@tanstack/react-query';
import type { FolderListItem, ListResult } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import {
  applyExtParams,
  hasListExtParams,
  type ListExtParams,
} from '../../../shared/views/list-ext/list-ext-query.js';

/** Ключи списка папок проекта (#435). */
export const projectFoldersKeys = {
  of: (projectId: string, extKey?: string) =>
    [...projectsKeys.all, projectId, 'folders', ...(extKey ? [{ ext: extKey }] : [])] as const,
};

/**
 * Папки проекта вкладкой-списком (#435, GET /projects/:id/folders): та же
 * машина расширения (фильтр/сортировка/группировка/итоги), рамка проекта —
 * путь адреса, клиентом не снимается. Курсорная подгрузка страниц.
 */
export function useProjectFolderPages(projectId: string, ext?: ListExtParams) {
  const extActive = ext !== undefined && hasListExtParams(ext);
  const extKey = extActive ? JSON.stringify(ext) : undefined;
  return useInfiniteQuery({
    queryKey: projectFoldersKeys.of(projectId, extKey),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (pageParam) params.set('cursor', pageParam);
      if (extActive) applyExtParams(params, ext!);
      return api<ListResult<FolderListItem>>(`/projects/${projectId}/folders?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: projectId.length > 0,
  });
}
