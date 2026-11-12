import { describe, expect, it, vi } from 'vitest';

import { ProjectParticipantsRepository } from './project-participants.repository.js';

describe('ProjectParticipantsRepository — роли и держатели (#433)', () => {
  it('rolesByProject: строки участия сотрудника', async () => {
    const findMany = vi.fn(async () => [
      { projectId: 'p-1', source: 'task' },
      { projectId: 'p-2', source: 'observer' },
    ]);
    const repository = new ProjectParticipantsRepository({
      projectParticipant: { findMany },
    } as never);
    await expect(repository.rolesByProject(undefined, 'u-1', ['p-1', 'p-2'])).resolves.toEqual([
      { projectId: 'p-1', source: 'task' },
      { projectId: 'p-2', source: 'observer' },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-1', projectId: { in: ['p-1', 'p-2'] } } }),
    );
    await expect(repository.rolesByProject(undefined, 'u-1', [])).resolves.toEqual([]);
  });

  it('userIdsBySources: уникальные держатели ролей', async () => {
    const findMany = vi.fn(async () => [{ userId: 'u-1' }]);
    const repository = new ProjectParticipantsRepository({
      projectParticipant: { findMany },
    } as never);
    await expect(
      repository.userIdsBySources(undefined, 'p-1', ['manager', 'task', 'member']),
    ).resolves.toEqual(['u-1']);
    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'p-1', source: { in: ['manager', 'task', 'member'] } },
      select: { userId: true },
      distinct: ['userId'],
    });
    await expect(repository.userIdsBySources(undefined, 'p-1', [])).resolves.toEqual([]);
  });

  it('convertSource: task→member; столкновение только с существующим member (#541)', async () => {
    const findMany = vi.fn(async () => [{ userId: 'u-2' }]);
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new ProjectParticipantsRepository({} as never);
    const tx = { projectParticipant: { findMany, deleteMany, updateMany } };

    await repository.convertSource(tx as never, 'p-1', ['u-1', 'u-2'], 'task', 'member');

    expect(findMany).toHaveBeenCalledWith({
      select: { userId: true },
      where: { projectId: 'p-1', userId: { in: ['u-1', 'u-2'] }, source: 'member' },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p-1', userId: { in: ['u-2'] }, source: 'task' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { projectId: 'p-1', userId: { in: ['u-1'] }, source: 'task' },
      data: { source: 'member', observerKind: null },
    });
  });
});
