import { describe, expect, it, vi } from 'vitest';

import { RoleAccessChangedHandler } from './role-access-changed.handler.js';

/**
 * Смена доступа роли (#866, AUD-002): access-токены всех затронутых
 * пользователей обесцениваются с моментом события — права из старого
 * JWT не действуют до истечения TTL.
 */
describe('RoleAccessChangedHandler', () => {
  it('отзывает токены каждого участника списка, дубли — один раз', async () => {
    const revoked = { revoke: vi.fn() };
    const handler = new RoleAccessChangedHandler(revoked as never);

    await handler.handle({
      id: 'e1',
      type: 'directory.role.access_changed',
      actorId: 'admin',
      payload: {
        roleId: 'role-1',
        reason: 'permissions',
        userIds: ['u1', 'u2', 'u1'],
      },
      createdAt: '2026-11-16T10:00:00.000Z',
    });

    const at = new Date('2026-11-16T10:00:00.000Z');
    expect(revoked.revoke).toHaveBeenCalledTimes(2);
    expect(revoked.revoke).toHaveBeenCalledWith('u1', at);
    expect(revoked.revoke).toHaveBeenCalledWith('u2', at);
  });

  it('повторная доставка события идемпотентна: revoke только вперёд', async () => {
    const revoked = { revoke: vi.fn() };
    const handler = new RoleAccessChangedHandler(revoked as never);
    const event = {
      id: 'e1',
      type: 'directory.role.access_changed',
      actorId: 'admin',
      payload: { roleId: 'role-1', reason: 'membership' as const, userIds: ['u1'] },
      createdAt: '2026-11-16T10:00:00.000Z',
    };

    await handler.handle(event);
    await handler.handle(event);

    expect(revoked.revoke).toHaveBeenCalledTimes(2);
    expect(revoked.revoke.mock.calls[0]).toEqual(revoked.revoke.mock.calls[1]);
  });

  it('пустой список — no-op', async () => {
    const revoked = { revoke: vi.fn() };
    const handler = new RoleAccessChangedHandler(revoked as never);

    await handler.handle({
      id: 'e1',
      type: 'directory.role.access_changed',
      actorId: 'admin',
      payload: { roleId: 'role-1', reason: 'membership', userIds: [] },
      createdAt: '2026-11-16T10:00:00.000Z',
    });

    expect(revoked.revoke).not.toHaveBeenCalled();
  });
});
