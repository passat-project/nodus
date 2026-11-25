import { describe, expect, it, vi } from 'vitest';

import { DepartmentsRepository } from './departments.repository.js';

/** #982/#1028: «корней вида» — один management (главная карточка компании). */
describe('DepartmentsRepository.countRoots (#1028)', () => {
  it('считает корни вида и читает через переданную транзакцию', async () => {
    const prisma = { department: { count: vi.fn().mockResolvedValue(1) } };
    const tx = { department: { count: vi.fn().mockResolvedValue(2) } };
    const repository = new DepartmentsRepository(prisma as never);

    await expect(repository.countRoots('management')).resolves.toBe(1);
    expect(prisma.department.count).toHaveBeenCalledWith({
      where: { kind: 'management', parentId: null },
    });

    await expect(repository.countRoots('legal', tx as never)).resolves.toBe(2);
    expect(tx.department.count).toHaveBeenCalledWith({
      where: { kind: 'legal', parentId: null },
    });
  });
});
