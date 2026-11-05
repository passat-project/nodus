import { describe, expect, it, vi } from 'vitest';

import { OrgStructureProvider } from './org-structure.provider.js';

function make() {
  const prisma = {
    user: { findUnique: vi.fn() },
    position: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return { provider: new OrgStructureProvider(prisma as never), prisma };
}

describe('OrgStructureProvider — решающие (#433)', () => {
  it('positionsOf: обе должности, архивная не отсекается, нет сотрудника — пусто', async () => {
    const { provider, prisma } = make();
    prisma.user.findUnique.mockResolvedValue({
      positionId: '00000000-0000-4000-8000-0000000000a1',
      legalPositionId: '00000000-0000-4000-8000-0000000000a2',
    } as never);
    await expect(provider.positionsOf('u-1')).resolves.toEqual([
      { positionId: '00000000-0000-4000-8000-0000000000a1', kind: 'management' },
      { positionId: '00000000-0000-4000-8000-0000000000a2', kind: 'legal' },
    ]);
    prisma.user.findUnique.mockResolvedValue(null as never);
    await expect(provider.positionsOf('u-1')).resolves.toEqual([]);
  });

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

  it('positionFacts: вид, активность и суммарные живые держатели', async () => {
    const { provider, prisma } = make();
    await expect(provider.positionFacts([])).resolves.toEqual(new Map());
    prisma.position.findMany.mockResolvedValue([
      {
        id: 'p-1',
        kind: 'management',
        isActive: true,
        _count: { users: 2, legalUsers: 1 },
      },
      { id: 'p-2', kind: 'legal', isActive: false, _count: { users: 0, legalUsers: 0 } },
    ] as never);
    await expect(provider.positionFacts(['p-1', 'p-2'])).resolves.toEqual(
      new Map([
        ['p-1', { kind: 'management', isActive: true, holders: 3 }],
        ['p-2', { kind: 'legal', isActive: false, holders: 0 }],
      ]),
    );
  });
});
