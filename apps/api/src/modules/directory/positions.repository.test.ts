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
    position: { findFirst: vi.fn(), delete: vi.fn() },
    user: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
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
    });
  });

  it('findAllByKind — все строки вида: архива у должностей больше нет (#768)', async () => {
    prisma.position.findMany.mockResolvedValue([{ id: 'p-1' }]);
    await repo.findAllByKind('management');
    expect(prisma.position.findMany).toHaveBeenCalledWith({
      where: { kind: 'management' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
  });

  it('findRef отдаёт только id и вид: активность у должности не проверяется', async () => {
    prisma.position.findUnique.mockResolvedValue({ id: 'p-1', kind: 'management' });
    await expect(repo.findRef('p-1')).resolves.toEqual({ id: 'p-1', kind: 'management' });
    expect(prisma.position.findUnique).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      select: { id: true, kind: true },
    });
  });

  it('remove удаляет строку жёстко в транзакции', async () => {
    await repo.remove('p-1', tx as never);
    expect(tx.position.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
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

  it('countHolders считает всех сотрудников в ОБЕИХ колонках (страховка вида)', async () => {
    tx.user.count.mockResolvedValue(2);
    await expect(repo.countHolders('p-1', tx as never)).resolves.toBe(2);
    expect(tx.user.count).toHaveBeenCalledWith({
      where: { OR: [{ positionId: 'p-1' }, { legalPositionId: 'p-1' }] },
    });
  });

  it('reassignHolders переводит всех держателей своей колонки и отдаёт их id', async () => {
    tx.user.findMany.mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]);
    tx.user.updateMany.mockResolvedValue({ count: 2 });
    await expect(repo.reassignHolders('p-1', 'p-2', 'management', tx as never)).resolves.toEqual([
      'u-1',
      'u-2',
    ]);
    expect(tx.user.findMany).toHaveBeenLastCalledWith({
      where: { positionId: 'p-1' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(tx.user.updateMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['u-1', 'u-2'] } },
      data: { positionId: 'p-2' },
    });
    await repo.reassignHolders('p-1', 'p-2', 'legal', tx as never);
    expect(tx.user.updateMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['u-1', 'u-2'] } },
      data: { legalPositionId: 'p-2' },
    });
  });

  it('reassignHolders без держателей не пишет в базу', async () => {
    tx.user.findMany.mockResolvedValue([]);
    await expect(repo.reassignHolders('p-1', 'p-2', 'management', tx as never)).resolves.toEqual(
      [],
    );
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
});
