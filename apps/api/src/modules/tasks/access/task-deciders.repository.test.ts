import { describe, expect, it, vi } from 'vitest';

import { TaskDecidersRepository } from './task-deciders.repository.js';

describe('TaskDecidersRepository (#433)', () => {
  it('кандидаты и минимальная строка задачи', async () => {
    const findMany = vi.fn(async () => [{ id: 'task-1' }]);
    const findFirst = vi.fn(async () => ({ id: 'task-1' }));
    const repository = new TaskDecidersRepository({
      task: { findMany, findFirst },
    } as never);

    await expect(repository.findCandidates(['wf-1'], ['stage-1'], false)).resolves.toEqual([
      { id: 'task-1' },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, workflowId: { in: ['wf-1'] }, stageId: { in: ['stage-1'] } },
        take: 5000,
      }),
    );
    // catch-all: без фильтра по стадиям
    await repository.findCandidates(['wf-1'], ['stage-1'], true);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, workflowId: { in: ['wf-1'] } },
      }),
    );
    await expect(repository.findTask('task-1')).resolves.toEqual({ id: 'task-1' });
  });

  it('участие и наблюдатель: только вставка, без upsert', async () => {
    const participantFindMany = vi.fn(async () => [{ userId: 'u1' }]);
    const participantFindUnique = vi.fn(async () => ({ userId: 'u1' }));
    const participantCreate = vi.fn(async () => void 0);
    const repository = new TaskDecidersRepository({
      taskParticipant: {
        findMany: participantFindMany,
        findUnique: participantFindUnique,
        create: participantCreate,
      },
    } as never);

    const tx = {
      taskParticipant: { findUnique: participantFindUnique, create: participantCreate },
    };
    await expect(repository.participantIds('task-1')).resolves.toEqual(['u1']);
    await expect(repository.findParticipant(tx as never, 'task-1', 'u1')).resolves.toBe(true);
    participantFindUnique.mockResolvedValue(null as never);
    await expect(repository.findParticipant(tx as never, 'task-1', 'u1')).resolves.toBe(false);
    await repository.insertObserver(tx as never, 'task-1', 'u1');
    expect(participantCreate).toHaveBeenCalledWith({
      data: { taskId: 'task-1', userId: 'u1', role: 'observer', muted: true },
    });
  });
});
