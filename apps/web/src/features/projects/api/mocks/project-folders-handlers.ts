import { http, HttpResponse } from 'msw';
import type { FolderListItem } from '@nodus/contracts';

import { demoNodeRows } from '../../../../shared/mocks/data/project-nodes.js';
import { folderRowValue } from '../../../../shared/views/list-ext/list-field-values.js';
import {
  applyMockExt,
  parseMockExt,
} from '../../../../shared/views/list-ext/mocks/mock-list-ext.js';

/** Список папок проекта (#435, GET /projects/:id/folders): демо-папки — строки
 * структуры проекта; ext-конвейер (фильтр/сортировка/группировка/итоги) —
 * движок-зеркало сервера. Рамка проекта — путь адреса, не снимается. */
export const projectFoldersHandlers = [
  http.get('/api/v1/projects/:id/folders', ({ params, request }) => {
    const projectId = String(params.id);
    const folders: FolderListItem[] = demoNodeRows
      .filter((row) => row.projectId === projectId)
      .map((row) => ({
        id: row.id,
        projectId: row.projectId,
        parentId: row.parentId,
        kindId: row.kindId,
        name: row.name,
        code: row.code,
        customFields: row.customFields,
        createdAt: row.createdAt,
      }));
    const ext = parseMockExt(new URL(request.url));
    const hasExt =
      ext.filter.length > 0 ||
      ext.sort.length > 0 ||
      ext.group !== undefined ||
      ext.totals.length > 0;
    const result = hasExt
      ? applyMockExt({
          rows: folders,
          ...ext,
          entity: 'folder',
          valueOf: folderRowValue,
          definitions: [],
        })
      : null;
    const rows = result ? result.items : folders;
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100);
    const cursor = url.searchParams.get('cursor');
    const start = cursor ? Number(cursor) || 0 : 0;
    const next = start + limit < rows.length ? String(start + limit) : null;
    return HttpResponse.json({
      items: rows.slice(start, start + limit),
      nextCursor: next,
      ...(result?.groups ? { groups: result.groups } : {}),
      ...(result?.totals ? { totals: result.totals } : {}),
    });
  }),
];
