import { describe, expect, it, vi } from 'vitest';

import { UserRolesChangedHandler } from './user-roles-changed.handler.js';

/**
 * Смена ролей или подразделения сотрудника карточкой (#866, AUD-002):
 * действующие права меняются — выданный ранее access-токен обесценивается.
 */
describe('UserRolesChangedHandler', () => {
  const event = (changedFields: string[]) => ({
    id: 'e1',
    type: 'directory.user.updated',
    actorId: 'admin',
    payload: { userId: 'u1', changedFields },
    createdAt: '2026-11-16T10:00:00.000Z',
  });

  it.each([['roleIds'], ['departmentId']])(
    'changedFields=%j — токен сотрудника отозван',
    async (field) => {
      const revoked = { revoke: vi.fn() };
      const handler = new UserRolesChangedHandler(revoked as never);

      await handler.handle(event(['displayName', field]));

      expect(revoked.revoke).toHaveBeenCalledWith('u1', new Date('2026-11-16T10:00:00.000Z'));
    },
  );

  it('правки профиля и аватара токены не трогают', async () => {
    const revoked = { revoke: vi.fn() };
    const handler = new UserRolesChangedHandler(revoked as never);

    await handler.handle(event(['displayName', 'avatarFileId']));

    expect(revoked.revoke).not.toHaveBeenCalled();
  });

  it('payload без changedFields — no-op', async () => {
    const revoked = { revoke: vi.fn() };
    const handler = new UserRolesChangedHandler(revoked as never);

    await handler.handle({
      id: 'e1',
      type: 'directory.user.updated',
      actorId: 'admin',
      payload: { userId: 'u1' },
      createdAt: '2026-11-16T10:00:00.000Z',
    });

    expect(revoked.revoke).not.toHaveBeenCalled();
  });
});
