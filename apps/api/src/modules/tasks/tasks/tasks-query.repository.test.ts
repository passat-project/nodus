import { describe, expect, it, vi } from 'vitest';

import { TasksQueryRepository } from './tasks-query.repository.js';

describe('TasksQueryRepository.listSubtasks', () => {
  it('первые N подзадач по номеру ПО ВОЗРАСТАНИЮ (переполнение теряет поздние, не ранние)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repo = new TasksQueryRepository({ task: { findMany } } as never);
    const visible = { deletedAt: null };
    await repo.listSubtasks('p1', visible, 200, 'viewer');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ parentId: 'p1' }, visible] },
        orderBy: { number: 'asc' },
        take: 200,
      }),
    );
  });
});

describe('TasksQueryRepository.feedFilters', () => {
  it('поиск «ПП-N» ищет и по номеру; просрочка — только открытые', () => {
    const repo = new TasksQueryRepository({} as never);
    const now = new Date('2026-10-20T00:00:00Z');
    const filters = repo.feedFilters(
      { search: 'ПП-12', overdue: true, role: 'assignee' } as never,
      'me',
      now,
    );
    expect(filters).toEqual([
      { assigneeId: 'me' },
      { deadline: { lt: now }, systemState: { in: ['backlog', 'active', 'paused'] } },
      {
        OR: [{ title: { contains: 'ПП-12', mode: 'insensitive' } }, { number: 12 }],
      },
    ]);
  });
});

describe('TasksQueryRepository.findIdsBySearch (#956)', () => {
  it('ищет живые задачи по номеру и названию, отдаёт id', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'task-1' }, { id: 'task-2' }]);
    const repo = new TasksQueryRepository({ task: { findMany } } as never);

    await expect(repo.findIdsBySearch('ПП-12', 200)).resolves.toEqual(['task-1', 'task-2']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          OR: [{ title: { contains: 'ПП-12', mode: 'insensitive' } }, { number: 12 }],
        },
        take: 200,
      }),
    );
  });

  it('нечисловой запрос — только поиск по названию', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repo = new TasksQueryRepository({ task: { findMany } } as never);

    await repo.findIdsBySearch('смета', 50);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          OR: [{ title: { contains: 'смета', mode: 'insensitive' } }],
        },
        take: 50,
      }),
    );
  });
});
