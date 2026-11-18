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

/** Перевод главы/зама (#923): снимаем роль только в СТАРОМ подразделении —
 *  один сотрудник одно место в структуре, остальные узлы не трогаются. */
describe('DepartmentsRepository.clearLeadershipIn (#923)', () => {
  const tx = {
    $queryRaw: vi.fn(),
    department: { updateMany: vi.fn() },
  };
  const repository = new DepartmentsRepository({} as never);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('сотрудник в узле не глава и не зам — без записи', async () => {
    tx.$queryRaw.mockResolvedValue([{ headId: 'other', deputyId: null }]);

    await expect(repository.clearLeadershipIn('d1', 'u1', tx as never)).resolves.toBeNull();
    expect(tx.department.updateMany).not.toHaveBeenCalled();
  });

  it('узла нет — без записи', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(repository.clearLeadershipIn('d1', 'u1', tx as never)).resolves.toBeNull();
    expect(tx.department.updateMany).not.toHaveBeenCalled();
  });

  it('глава — headId снимается адресно, зам-ссылка не тронута', async () => {
    tx.$queryRaw.mockResolvedValue([{ headId: 'u1', deputyId: 'other' }]);

    await expect(repository.clearLeadershipIn('d1', 'u1', tx as never)).resolves.toEqual({
      head: true,
      deputy: false,
    });
    expect(tx.department.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.department.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', headId: 'u1' },
      data: { headId: null },
    });
  });

  it('зам — deputyId снимается адресно', async () => {
    tx.$queryRaw.mockResolvedValue([{ headId: 'other', deputyId: 'u1' }]);

    await expect(repository.clearLeadershipIn('d1', 'u1', tx as never)).resolves.toEqual({
      head: false,
      deputy: true,
    });
    expect(tx.department.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', deputyId: 'u1' },
      data: { deputyId: null },
    });
  });
});
