import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../../generated/prisma/client.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import type { SearchSqlParams } from './search-query.sql.js';
import { SearchRepository } from './search.repository.js';

const params = (): SearchSqlParams => ({
  q: 'смета',
  likePrefix: 'смета%',
  digits: null,
  actorId: '11111111-1111-4111-8111-111111111111',
  enabledTypes: ['task'],
  types: ['task'],
  visibility: Prisma.empty,
  counterpartyIds: [],
  sort: 'relevance',
  cursor: null,
  limit: 20,
});

const repositoryWith = () => {
  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    $queryRaw: vi.fn(),
  };
  const prisma = {
    $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  };
  return { repo: new SearchRepository(prisma as never), tx };
};

/**
 * Счётчики выдачи (#952, Р14): считаются по полному предикату совпадения, а
 * не по окнам поисковых ног; триграммы — второй фазой только когда FTS дал
 * < 5 строк (как в самой выдаче). Таймаут — явный SEARCH_TIMEOUT.
 */
describe('репозиторий поиска: счётчики и таймаут (#952)', () => {
  it('мало FTS-совпадений — счётчики пересчитываются с триграммами', async () => {
    const { repo, tx } = repositoryWith();
    tx.$queryRaw
      .mockResolvedValueOnce([{ source_type: 'task', cnt: 1, fts_cnt: 1 }])
      .mockResolvedValueOnce([{ source_type: 'task', cnt: 3, fts_cnt: 1 }])
      .mockResolvedValueOnce([]);

    const result = await repo.search(params());

    expect(result.counts).toEqual([{ source_type: 'task', cnt: 3, fts_cnt: 1 }]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('FTS дал ≥ 5 строк — триграммы не считаются', async () => {
    const { repo, tx } = repositoryWith();
    tx.$queryRaw
      .mockResolvedValueOnce([{ source_type: 'task', cnt: 5, fts_cnt: 5 }])
      .mockResolvedValueOnce([]);

    await repo.search(params());

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('statement timeout → SEARCH_TIMEOUT, а не пустая выдача', async () => {
    const { repo, tx } = repositoryWith();
    tx.$queryRaw.mockRejectedValueOnce(new Error('canceling statement due to statement timeout'));

    await expect(repo.search(params())).rejects.toBeInstanceOf(DomainException);
  });
});
