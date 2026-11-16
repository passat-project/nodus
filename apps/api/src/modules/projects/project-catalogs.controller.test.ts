import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission, type ProjectGroup } from '@nodus/contracts';

import { AUDIT_KEY } from '../../core/decorators/audit.decorator.js';
import { PERMISSIONS_KEY } from '../../core/decorators/require-permissions.decorator.js';
import { ProjectCatalogsController } from './project-catalogs.controller.js';

/** Портфель-папка: удаление навсегда — отдельный маршрут с правом
 *  project.manage и записью в аудит (I8, I7). Архива у папки нет (13.11.2026). */
const GROUP: ProjectGroup = {
  id: '42000000-0000-4000-8000-000000000001',
  name: 'Нежин-Недра',
};

function makeController() {
  const groups = {
    list: vi.fn(),
    findActive: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    setArchived: vi.fn(),
    delete: vi.fn(),
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

describe('DELETE /projects/groups/:id/permanent (#559)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('маршрут под project.manage, в аудите и 204 (удаление навсегда)', () => {
    const handler = ProjectCatalogsController.prototype.groupDelete;

    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([Permission.PROJECT_MANAGE]);
    expect(Reflect.getMetadata(AUDIT_KEY, handler)).toEqual({
      action: 'project.group_delete',
      entity: 'project_group',
    });
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(204);
  });

  it('удаляет портфель в транзакции (проекты — в «Без портфеля»)', async () => {
    const { controller, groups, tx } = makeController();
    groups.delete.mockResolvedValue({ name: 'Нежин-Недра', projects: 3 });
    const request: { auditDetails?: Record<string, unknown> } = {};

    await expect(controller.groupDelete(GROUP.id, request as never)).resolves.toBeUndefined();
    expect(groups.delete).toHaveBeenCalledWith(tx, GROUP.id);
    // Необратимое действие: имя папки и число перенесённых проектов — в аудит.
    expect(request.auditDetails).toEqual({ portfolio: 'Нежин-Недра', projects: 3 });
  });

  it('неизвестный портфель — 404, а не молчаливое «удалено»', async () => {
    const { controller, groups } = makeController();
    groups.delete.mockResolvedValue(null);

    await expect(controller.groupDelete(GROUP.id, {} as never)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
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
