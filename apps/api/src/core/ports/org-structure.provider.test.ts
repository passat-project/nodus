import { describe, expect, it, vi } from 'vitest';

import { OrgStructureProvider } from './org-structure.provider.js';

function make() {
  const prisma = {
    user: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return { provider: new OrgStructureProvider(prisma as never), prisma };
}

describe('OrgStructureProvider — решающие (#433)', () => {
  it('managersOf: ближайший на каждого, пустой вход — без запроса', async () => {
    const { provider, prisma } = make();
    await expect(provider.managersOf([])).resolves.toEqual(new Map());
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    prisma.$queryRaw.mockResolvedValue([
      { origin: 'u-1', managerId: 'm-1' },
      { origin: 'u-2', managerId: 'm-2' },
    ] as never);
    await expect(provider.managersOf(['u-1', 'u-2', 'u-1'])).resolves.toEqual(
      new Map([
        ['u-1', 'm-1'],
        ['u-2', 'm-2'],
      ]),
    );
  });
});
