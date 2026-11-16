import { describe, expect, it, vi } from 'vitest';

import { ProjectGroupsRepository } from './project-groups.repository.js';

/**
 * Удаление портфеля (#559): проекты не теряются — переходят в «Без портфеля».
 * Обнуление ссылок и удаление папки идут в одной транзакции, ссылки снимаются
 * ДО удаления (FK `onDelete: SetNull` — страховка, но поведение детерминировано
 * нашим updateMany). Имя папки и число проектов возвращаются для аудита.
 */
function makeTx() {
  return {
    project: { updateMany: vi.fn() },
    projectGroup: { findUnique: vi.fn(), deleteMany: vi.fn() },
  };
}

describe('ProjectGroupsRepository.delete (#559)', () => {
  it('обнуляет портфель у проектов и удаляет папку в одной транзакции', async () => {
    const tx = makeTx();
    tx.projectGroup.findUnique.mockResolvedValue({ name: 'Нежин-Недра' });
    tx.project.updateMany.mockResolvedValue({ count: 3 });
    tx.projectGroup.deleteMany.mockResolvedValue({ count: 1 });
    const repo = new ProjectGroupsRepository({} as never);

    await expect(repo.delete(tx as never, 'group-1')).resolves.toEqual({
      name: 'Нежин-Недра',
      projects: 3,
    });

    expect(tx.project.updateMany).toHaveBeenCalledWith({
      where: { portfolioId: 'group-1' },
      data: { portfolioId: null },
    });
    expect(tx.projectGroup.deleteMany).toHaveBeenCalledWith({ where: { id: 'group-1' } });
    // Сначала снимаем ссылки, потом удаляем папку — обратного порядка нет.
    expect(tx.project.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectGroup.deleteMany.mock.invocationCallOrder[0]!,
    );
  });

  it('пустая папка тоже удаляется (проектов нет — переносить нечего)', async () => {
    const tx = makeTx();
    tx.projectGroup.findUnique.mockResolvedValue({ name: 'Пустая' });
    tx.project.updateMany.mockResolvedValue({ count: 0 });
    tx.projectGroup.deleteMany.mockResolvedValue({ count: 1 });
    const repo = new ProjectGroupsRepository({} as never);

    await expect(repo.delete(tx as never, 'group-1')).resolves.toEqual({
      name: 'Пустая',
      projects: 0,
    });
    expect(tx.project.updateMany).toHaveBeenCalledTimes(1);
  });

  it('неизвестная папка — null (контроллер отдаст 404), проекты не тронуты', async () => {
    const tx = makeTx();
    tx.projectGroup.findUnique.mockResolvedValue(null);
    const repo = new ProjectGroupsRepository({} as never);

    await expect(repo.delete(tx as never, 'missing')).resolves.toBeNull();
    expect(tx.project.updateMany).not.toHaveBeenCalled();
    expect(tx.projectGroup.deleteMany).not.toHaveBeenCalled();
  });
});
