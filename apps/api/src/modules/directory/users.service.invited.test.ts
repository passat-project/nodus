import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AuthUser } from '@nodus/contracts';

import { UsersService } from './users.service.js';

const ACTOR: AuthUser = {
  id: 'admin-1',
  email: 'admin@nodus.by',
  displayName: 'Админ',
  permissions: [],
};

/** Правки карточки приглашённого (#101): роль до активации не выдаётся. */
describe('UsersService: приглашённый (#101)', () => {
  it('roleIds приглашённому → CONFLICT без записи ролей/карточки', async () => {
    const users = {
      findCardById: vi.fn(async () => ({ id: 'user-1', status: 'invited' })),
      update: vi.fn(),
      setRoles: vi.fn(),
    };
    const service = new UsersService(
      users as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.updateUser('user-1', { roleIds: ['role-1'] }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(users.setRoles).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });
});
