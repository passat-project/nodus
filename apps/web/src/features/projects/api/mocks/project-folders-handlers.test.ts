// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';

// Хендлер первым: его импорты грузят демо-мир в порядке, разрывающем цикл
// project-nodes → tasks → projects → project-types → nodeKindIds.
import { projectFoldersHandlers } from './project-folders-handlers.js';
import { demoNodeRows } from '../../../../shared/mocks/data/project-nodes.js';
import { projectRefs } from '../../../../shared/mocks/data/task-item-factory.js';

/**
 * Мок списка папок проекта (#435): рамка проекта — путь адреса (чужие
 * проекты не подтекают), ext-конвейер сортирует и группирует те же строки.
 */

const server = setupServer(...projectFoldersHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

interface FoldersPage {
  items: { id: string; name: string }[];
  nextCursor: string | null;
  groups?: { key: string | number | null; count: number }[];
}

async function list(projectId: string, query = ''): Promise<FoldersPage> {
  const response = await fetch(`/api/v1/projects/${projectId}/folders?limit=100${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as FoldersPage;
}

describe('мок /projects/:id/folders (#435)', () => {
  it('отдаёт папки только этого проекта (рамка пути)', async () => {
    const page = await list(projectRefs.p4.id);
    const expected = demoNodeRows.filter((row) => row.projectId === projectRefs.p4.id);
    expect(page.items.map((item) => item.id).sort()).toEqual(expected.map((row) => row.id).sort());
    const other = await list('00000000-0000-4000-8000-00000000000f');
    expect(other.items).toEqual([]);
  });

  it('сортировка по имени и группировка по виду папки', async () => {
    const sort = encodeURIComponent(JSON.stringify([{ field: 'name', dir: 'asc' }]));
    const sorted = await list(projectRefs.p4.id, `&sort=${sort}`);
    const names = sorted.items.map((item) => item.name);
    // Порядок движка — кодточечный (как серверный text ORDER BY).
    expect([...names].sort()).toEqual(names);

    const group = encodeURIComponent(JSON.stringify({ field: 'kind' }));
    const grouped = await list(projectRefs.p4.id, `&group=${group}`);
    expect(grouped.groups).toBeDefined();
    const totalGrouped = grouped.groups!.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(totalGrouped).toBe(
      demoNodeRows.filter((row) => row.projectId === projectRefs.p4.id).length,
    );
  });
});
