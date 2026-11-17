import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DepartmentsRepository } from './departments.repository.js';

/** Снятие главы/зама при увольнении (#923): ссылки очищаются во ВСЕХ
 *  подразделениях, где сотрудник руководитель, строки читаются под FOR UPDATE. */
describe('DepartmentsRepository.clearHeadAndDeputy (#923)', () => {
  const tx = {
    $queryRaw: vi.fn(),
    department: { updateMany: vi.fn() },
  };
  const repository = new DepartmentsRepository({} as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('сотрудник нигде не глава и не зам — без записи', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(repository.clearHeadAndDeputy('u1', tx as never)).resolves.toEqual([]);
    expect(tx.department.updateMany).not.toHaveBeenCalled();
  });

  it('глава и зам разных подразделений — обе ссылки очищаются, флаги возвращаются', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: 'd1', headId: 'u1', deputyId: null },
      { id: 'd2', headId: 'other', deputyId: 'u1' },
    ]);

    const cleared = await repository.clearHeadAndDeputy('u1', tx as never);

    expect(tx.department.updateMany).toHaveBeenCalledWith({
      where: { headId: 'u1' },
      data: { headId: null },
    });
    expect(tx.department.updateMany).toHaveBeenCalledWith({
      where: { deputyId: 'u1' },
      data: { deputyId: null },
    });
    expect(cleared).toEqual([
      { id: 'd1', head: true, deputy: false },
      { id: 'd2', head: false, deputy: true },
    ]);
  });
});
