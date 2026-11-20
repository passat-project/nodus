import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DepartmentsRepository } from './departments.repository.js';

/** Снятие главы/зама при увольнении (#923, #817): ссылки очищаются во ВСЕХ
 *  подразделениях, где сотрудник руководитель, строки читаются под FOR UPDATE. */
describe('DepartmentsRepository.clearHeadAndDeputy (#923, #817)', () => {
  const tx = {
    $queryRaw: vi.fn(),
    department: { updateMany: vi.fn() },
    departmentDeputy: { deleteMany: vi.fn() },
  };
  const repository = new DepartmentsRepository({} as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('сотрудник нигде не глава и не зам — без записи', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(repository.clearHeadAndDeputy('u1', tx as never)).resolves.toEqual([]);
    expect(tx.department.updateMany).not.toHaveBeenCalled();
    expect(tx.departmentDeputy.deleteMany).not.toHaveBeenCalled();
  });

  it('глава и зам разных подразделений — обе роли снимаются, флаги возвращаются', async () => {
    tx.$queryRaw.mockResolvedValue([
      { id: 'd1', headId: 'u1', deputy: false },
      { id: 'd2', headId: 'other', deputy: true },
    ]);

    const cleared = await repository.clearHeadAndDeputy('u1', tx as never);

    expect(tx.department.updateMany).toHaveBeenCalledWith({
      where: { headId: 'u1' },
      data: { headId: null },
    });
    expect(tx.departmentDeputy.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(cleared).toEqual([
      { id: 'd1', head: true, deputy: false },
      { id: 'd2', head: false, deputy: true },
    ]);
  });
});

/** Перевод главы/зама (#923, #817): снимаем роль только в СТАРОМ подразделении —
 *  один сотрудник одно место в структуре, остальные узлы не трогаются. */
describe('DepartmentsRepository.clearLeadershipIn (#923, #817)', () => {
  const tx = {
    $queryRaw: vi.fn(),
    department: { updateMany: vi.fn() },
    departmentDeputy: { deleteMany: vi.fn() },
  };
  const repository = new DepartmentsRepository({} as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('сотрудник в узле не глава и не зам — без записи', async () => {
    tx.$queryRaw.mockResolvedValue([{ headId: 'other', deputy: false }]);

    await expect(repository.clearLeadershipIn('d1', 'u1', tx as never)).resolves.toBeNull();
    expect(tx.department.updateMany).not.toHaveBeenCalled();
    expect(tx.departmentDeputy.deleteMany).not.toHaveBeenCalled();
  });

  it('узла нет — без записи', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(repository.clearLeadershipIn('d1', 'u1', tx as never)).resolves.toBeNull();
    expect(tx.department.updateMany).not.toHaveBeenCalled();
  });

  it('глава — headId снимается адресно, строка зама не тронута', async () => {
    tx.$queryRaw.mockResolvedValue([{ headId: 'u1', deputy: false }]);

    await expect(repository.clearLeadershipIn('d1', 'u1', tx as never)).resolves.toEqual({
      head: true,
      deputy: false,
    });
    expect(tx.department.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.department.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', headId: 'u1' },
      data: { headId: null },
    });
    expect(tx.departmentDeputy.deleteMany).not.toHaveBeenCalled();
  });

  it('зам — строка department_deputies снимается адресно', async () => {
    tx.$queryRaw.mockResolvedValue([{ headId: 'other', deputy: true }]);

    await expect(repository.clearLeadershipIn('d1', 'u1', tx as never)).resolves.toEqual({
      head: false,
      deputy: true,
    });
    expect(tx.departmentDeputy.deleteMany).toHaveBeenCalledWith({
      where: { departmentId: 'd1', userId: 'u1' },
    });
    expect(tx.department.updateMany).not.toHaveBeenCalled();
  });
});
