import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionsRepository } from './positions.repository.js';

/**
 * Репозиторий должностей (#768): строки под FOR UPDATE, счётчики и
 * переназначение ВСЕХ сотрудников (включая уволенных — вердикт 13.11.2026),
 * поиск по имени без учёта регистра. Prisma-клиент mocked — проверяются
 * выбранные условия, не SQL-текст.
 */
describe('PositionsRepository', () => {
  const prisma = {
    position: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  const tx = {
    $queryRaw: vi.fn(),
    position: { findFirst: vi.fn() },
    user: { count: vi.fn(), updateMany: vi.fn() },
  };
  const repo = new PositionsRepository(prisma as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findById читает строку без фильтра активности', async () => {
    prisma.position.findUnique.mockResolvedValue({ id: 'p-1' });
    await expect(repo.findById('p-1')).resolves.toEqual({ id: 'p-1' });
    expect(prisma.position.findUnique).toHaveBeenCalledWith({ where: { id: 'p-1' } });
  });

  it('findByName ищет без учёта регистра в пределах вида', async () => {
    tx.position.findFirst.mockResolvedValue({ id: 'p-1' });
    await repo.findByName('Инженер', 'management', tx as never);
    expect(tx.position.findFirst).toHaveBeenCalledWith({
      where: { name: { equals: 'Инженер', mode: 'insensitive' }, kind: 'management' },
      orderBy: { isActive: 'desc' },
    });
  });

  it('lockForUpdate берёт строку FOR UPDATE и сообщает, нашлась ли она', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'p-1' }]).mockResolvedValueOnce([]);
    await expect(repo.lockForUpdate('p-1', tx as never)).resolves.toBe(true);
    await expect(repo.lockForUpdate('p-2', tx as never)).resolves.toBe(false);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('lockMany сортирует id и не дергает БД на пустом списке', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await repo.lockMany(['b', 'a', 'a'], tx as never);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    await repo.lockMany([], tx as never);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('countHolders считает всех сотрудников, включая уволенных', async () => {
    tx.user.count.mockResolvedValue(2);
    await expect(repo.countHolders('p-1', 'management', tx as never)).resolves.toBe(2);
    expect(tx.user.count).toHaveBeenLastCalledWith({
      where: { positionId: 'p-1' },
    });
    await repo.countHolders('p-1', 'legal', tx as never);
    expect(tx.user.count).toHaveBeenLastCalledWith({
      where: { legalPositionId: 'p-1' },
    });
  });

  it('reassignHolders двигает всех сотрудников, включая уволенных', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 3 });
    await expect(repo.reassignHolders('p-1', 'p-2', 'management', tx as never)).resolves.toBe(3);
    expect(tx.user.updateMany).toHaveBeenLastCalledWith({
      where: { positionId: 'p-1' },
      data: { positionId: 'p-2' },
    });
    await repo.reassignHolders('p-1', 'p-2', 'legal', tx as never);
    expect(tx.user.updateMany).toHaveBeenLastCalledWith({
      where: { legalPositionId: 'p-1' },
      data: { legalPositionId: 'p-2' },
    });
  });
});
