import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersRepository } from './users.repository.js';

/**
 * Пачечная проверка ссылок (#817): набор заместителей валидируется одним
 * запросом, повторные id не дублируются, пустой набор не ходит в БД.
 */

const prisma = { user: { findMany: vi.fn() } };

describe('UsersRepository.findRefs', () => {
  const repository = new UsersRepository(prisma as never);

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.user.findMany.mockResolvedValue([]);
  });

  it('один запрос на набор, повторные id схлопываются', async () => {
    await repository.findRefs(['u-1', 'u-2', 'u-1']);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u-1', 'u-2'] } },
      select: { id: true, status: true },
    });
  });

  it('пустой набор — без запроса к БД', async () => {
    await expect(repository.findRefs([])).resolves.toEqual([]);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
