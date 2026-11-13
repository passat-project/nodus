import { describe, expect, it, vi } from 'vitest';

import { UserProfileProvider } from './user-profile.provider.js';

describe('UserProfileProvider.listActiveIds (#434)', () => {
  it('снимок активных сотрудников — стабильный порядок ФИО → id', async () => {
    const findMany = vi.fn(async () => [{ id: 'u1' }, { id: 'u2' }]);
    const provider = new UserProfileProvider({ user: { findMany } } as never, {} as never);
    await expect(provider.listActiveIds()).resolves.toEqual(['u1', 'u2']);
    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      select: { id: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    });
  });
});
