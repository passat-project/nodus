import { describe, expect, it, vi } from 'vitest';

import { ProjectHistoryRepository } from './project-history.repository.js';

/** Лента истории и граница секретной эпохи (#748): нижняя граница — seq
 *  последней смены видимости, ключи курсора — по seq. */
describe('ProjectHistoryRepository (#748)', () => {
  it('findPage: keyset сверху и граница раскрытия снизу', async () => {
    const findMany = vi.fn(async () => []);
    const repo = new ProjectHistoryRepository({ event: { findMany } } as never);

    await repo.findPage('p-1', 30n, 10, 15n);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          aggregateType: 'project',
          aggregateId: 'p-1',
          seq: { lt: 30n, gte: 15n },
        }),
        orderBy: { seq: 'desc' },
        take: 11,
      }),
    );
  });

  it('findPage без границ: фильтр seq пустой, страница та же', async () => {
    const findMany = vi.fn(async () => []);
    const repo = new ProjectHistoryRepository({ event: { findMany } } as never);

    await repo.findPage('p-1', null, 10);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ seq: {} }) }),
    );
  });

  it('findLastVisibilityChangeSeq: seq последней смены видимости', async () => {
    const findFirst = vi.fn(async () => ({ seq: 42n }));
    const repo = new ProjectHistoryRepository({ event: { findFirst } } as never);

    await expect(repo.findLastVisibilityChangeSeq('p-1')).resolves.toBe(42n);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          aggregateType: 'project',
          aggregateId: 'p-1',
          type: 'project.updated',
          payload: { path: ['fields'], array_contains: ['visibility'] },
        }),
        orderBy: { seq: 'desc' },
      }),
    );
  });

  it('findLastVisibilityChangeSeq: не было смен видимости — null', async () => {
    const findFirst = vi.fn(async () => null);
    const repo = new ProjectHistoryRepository({ event: { findFirst } } as never);

    await expect(repo.findLastVisibilityChangeSeq('p-1')).resolves.toBeNull();
  });
});
