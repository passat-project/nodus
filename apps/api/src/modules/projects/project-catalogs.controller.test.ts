import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission, type ProjectGroup } from '@nodus/contracts';

import { AUDIT_KEY } from '../../core/decorators/audit.decorator.js';
import { PERMISSIONS_KEY } from '../../core/decorators/require-permissions.decorator.js';
import { ProjectCatalogsController } from './project-catalogs.controller.js';

/** Портфель-папка: архив/возврат — не удаление (#559). Возврат — отдельный
 *  маршрут с правом project.manage и записью в аудит (I8, I7). */
const GROUP: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
  archivedAt: null,
};

function makeController() {
  const groups = {
    list: vi.fn(),
    findActive: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    setArchived: vi.fn(),
  };
  const tx = {};
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn(tx) };
  const queries = { portfolioCounts: vi.fn() };
  const controller = new ProjectCatalogsController(
    {} as never,
    groups as never,
    {} as never,
    queries as never,
    txRunner as never,
    {} as never,
    {} as never,
  );
  return { controller, groups, queries, tx };
}

describe('POST /projects/groups/:id/restore (#559)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('маршрут под project.manage и в аудите', () => {
    const handler = ProjectCatalogsController.prototype.groupRestore;

    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([Permission.PROJECT_MANAGE]);
    expect(Reflect.getMetadata(AUDIT_KEY, handler)).toEqual({
      action: 'project.group_restore',
      entity: 'project_group',
    });
  });

  it('возвращает папку из архива в той же транзакции', async () => {
    const { controller, groups, tx } = makeController();
    groups.setArchived.mockResolvedValue(GROUP);

    await expect(controller.groupRestore(GROUP.id)).resolves.toEqual(GROUP);
    expect(groups.setArchived).toHaveBeenCalledWith(tx, GROUP.id, false);
  });

  it('неизвестная папка — 404, а не выдуманная строка', async () => {
    const { controller, groups } = makeController();
    groups.setArchived.mockResolvedValue(null);

    await expect(controller.groupRestore(GROUP.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('GET /projects/groups/counts: режим журнала (#559)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scope=mine и scope=all пробрасываются в сервис с актёром', async () => {
    const { controller, queries } = makeController();
    const user = { id: '20000000-0000-4000-8000-000000000001', permissions: [] };
    queries.portfolioCounts.mockResolvedValue([]);

    await controller.groupCounts({ scope: 'mine' }, user as never);
    expect(queries.portfolioCounts).toHaveBeenLastCalledWith(user, 'mine');

    await controller.groupCounts({ scope: 'all' }, user as never);
    expect(queries.portfolioCounts).toHaveBeenLastCalledWith(user, 'all');
  });
});
