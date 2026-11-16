import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RolesService } from './roles.service.js';

/** Строка роли в форме репозитория: `_count` и `preview` (ADR-0034). */
function record(overrides: Record<string, unknown> = {}) {
  return {
    row: {
      id: 'role-1',
      code: 'editor',
      name: 'Редактор',
      description: null,
      isSystem: false,
      permissions: [],
      _count: { users: 0, departments: 0 },
      ...overrides,
    },
    preview: [],
  };
}

/**
 * Удаление роли отзывает access-токены участников (#866, замечание
 * валидатора): состав фиксируется ДО каскада, отзыв эмитится после
 * `role.deleted` в той же транзакции — иначе права удалённой роли живут
 * в JWT до 15 минут.
 */
describe('RolesService.deleteRole: отзыв доступа (#866)', () => {
  const roles = { findById: vi.fn(), lockForUpdate: vi.fn(), delete: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };
  const signedUrls = { fileContentUrl: (id: string) => `/api/v1/files/${id}/content` };
  const audience = { roleUserIds: vi.fn() };

  let service: RolesService;

  beforeEach(() => {
    vi.clearAllMocks();
    roles.lockForUpdate.mockResolvedValue(true);
    audience.roleUserIds.mockResolvedValue([]);
    service = new RolesService(
      roles as never,
      tx as never,
      eventBus as never,
      signedUrls as never,
      audience as never,
    );
  });

  it('состав вычисляется ДО удаления и отзывается после role.deleted', async () => {
    roles.findById.mockResolvedValue(record({ _count: { users: 2, departments: 0 } }));
    audience.roleUserIds.mockResolvedValue(['u-1', 'u-2']);

    await service.deleteRole('role-1', 'admin-1');

    // Аудитория считается до каскада: после удаления роли состав пуст.
    expect(audience.roleUserIds).toHaveBeenCalledWith('role-1', 'tx-handle');
    expect(audience.roleUserIds.mock.invocationCallOrder[0]).toBeLessThan(
      roles.delete.mock.invocationCallOrder[0]!,
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.access_changed',
      { roleId: 'role-1', reason: 'membership', userIds: ['u-1', 'u-2'] },
      expect.objectContaining({
        actorId: 'admin-1',
        aggregateType: 'role',
        aggregateId: 'role-1',
      }),
    );
  });

  it('роль без действующих участников — только role.deleted', async () => {
    roles.findById.mockResolvedValue(record());

    await service.deleteRole('role-1', 'admin-1');

    expect(eventBus.emit).not.toHaveBeenCalledWith(
      'tx-handle',
      'directory.role.access_changed',
      expect.anything(),
      expect.anything(),
    );
  });
});
