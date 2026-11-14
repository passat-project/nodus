import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DepartmentsRepository } from './departments.repository.js';

/**
 * Замена набора заместителей (#817): полная перезапись связи (сервис зовёт
 * внутри транзакции) — старые строки удаляются, порядок массива становится
 * `sort_order`. Пустой набор — только удаление (снять всех).
 */

const prisma = {
  departmentDeputy: { deleteMany: vi.fn(), createMany: vi.fn() },
};

describe('DepartmentsRepository.setDeputies', () => {
  const repository = new DepartmentsRepository(prisma as never);

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.departmentDeputy.deleteMany.mockResolvedValue({ count: 0 });
    prisma.departmentDeputy.createMany.mockResolvedValue({ count: 0 });
  });

  it('перезаписывает набор, порядок массива = sort_order', async () => {
    await repository.setDeputies('dep-1', ['u-1', 'u-2']);

    expect(prisma.departmentDeputy.deleteMany).toHaveBeenCalledWith({
      where: { departmentId: 'dep-1' },
    });
    expect(prisma.departmentDeputy.createMany).toHaveBeenCalledWith({
      data: [
        { departmentId: 'dep-1', userId: 'u-1', sortOrder: 0 },
        { departmentId: 'dep-1', userId: 'u-2', sortOrder: 1 },
      ],
    });
  });

  it('пустой набор — снимает всех, вставки нет', async () => {
    await repository.setDeputies('dep-1', []);

    expect(prisma.departmentDeputy.deleteMany).toHaveBeenCalledWith({
      where: { departmentId: 'dep-1' },
    });
    expect(prisma.departmentDeputy.createMany).not.toHaveBeenCalled();
  });
});
