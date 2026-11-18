import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagerDerivationRepository } from './manager-derivation.repository.js';
import { ManagerDerivationService } from './manager-derivation.service.js';

/**
 * Производный руководитель (#923): репозиторий исполняет ОДИН рекурсивный CTE
 * и пишет только изменившиеся строки; сервис — тонкая делегация. Сам SQL
 * проверяется живым прогоном `directory-manager-derivation.integration.test.ts`
 * (unit-мок доказывает форму вызова, не семантику дерева).
 */
describe('ManagerDerivationRepository (#923)', () => {
  const tx = { $queryRaw: vi.fn() };
  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
  };

  let repository: ManagerDerivationRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((cb: (client: typeof tx) => unknown) => cb(tx));
    repository = new ManagerDerivationRepository(prisma as never);
  });

  it('пустой список — без запроса в БД', async () => {
    await expect(repository.recomputeForUsers([], tx as never)).resolves.toEqual([]);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('пересчёт пачки: один UPDATE-проход, возвращаются изменённые id', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);

    const changed = await repository.recomputeForUsers(['user-1', 'user-2'], tx as never);

    expect(changed).toEqual(['user-1', 'user-2']);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('пустой набор подразделений — без запроса', async () => {
    await expect(repository.recomputeForDepartments([], tx as never)).resolves.toEqual([]);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('пересчёт поддерева: сначала сотрудники поддерева, затем их руководители', async () => {
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'user-1' }])
      .mockResolvedValueOnce([{ id: 'user-1' }]);

    const changed = await repository.recomputeForDepartments(['dep-1'], tx as never);

    expect(changed).toEqual(['user-1']);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('recomputeAll — в транзакции по всем сотрудникам', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'user-1' }]);
    tx.$queryRaw.mockResolvedValue([{ id: 'user-1' }]);

    await expect(repository.recomputeAll()).resolves.toEqual(['user-1']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('ManagerDerivationService (#923)', () => {
  const repository = { recomputeForUsers: vi.fn(), recomputeForDepartments: vi.fn() };
  const service = new ManagerDerivationService(repository as never);

  it('делегирует пересчёт сотрудников и подразделений', async () => {
    repository.recomputeForUsers.mockResolvedValue(['u']);
    repository.recomputeForDepartments.mockResolvedValue(['u']);
    await service.recomputeUsers(['u'], 'tx' as never);
    await service.recomputeDepartments(['d'], 'tx' as never);
    expect(repository.recomputeForUsers).toHaveBeenCalledWith(['u'], 'tx');
    expect(repository.recomputeForDepartments).toHaveBeenCalledWith(['d'], 'tx');
  });
});
