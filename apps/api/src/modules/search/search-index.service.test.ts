import { describe, expect, it, vi } from 'vitest';

import type { SearchSourceProvider } from '../../core/ports/search-source.port.js';
import { SearchIndexService } from './search-index.service.js';

const validDate = new Date('2026-11-10T09:00:00.000Z');

const sourceRow = (overrides: Record<string, unknown> = {}) =>
  ({
    type: 'task',
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Согласовать смету',
    body: 'тело',
    keywords: 'ПП-1',
    payload: { number: 1 },
    authorId: null,
    participantIds: [],
    aclKind: 'task',
    confidential: false,
    registered: true,
    sourceCreatedAt: validDate,
    sourceUpdatedAt: validDate,
    ...overrides,
  }) as never;

const serviceWith = (provider: Partial<SearchSourceProvider> | null) => {
  const repository = { apply: vi.fn().mockResolvedValue(undefined), remove: vi.fn() };
  const registry = { get: () => provider };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const service = new SearchIndexService(repository as never, registry as never, logger as never);
  return { repository, logger, service };
};

/**
 * Индексатор проекции (#952): C0-чистка и обрезка до записи, tombstone с
 * версией (не стирает более новую строку), бэкфилл не крутится вечно на
 * провайдере с неподвижным курсором.
 */
describe('индексатор поисковой проекции (#952)', () => {
  it('indexIds чистит текст, обрезает и передаёт tombstone с версией', async () => {
    const provider = {
      load: vi
        .fn()
        .mockResolvedValue([
          sourceRow({ title: 'т'.repeat(600), body: `тело\u0001 ${'б'.repeat(5000)}` }),
          { type: 'task', id: 'b', deleted: true, sourceUpdatedAt: validDate },
        ]),
    } as unknown as SearchSourceProvider;
    const { repository, service } = serviceWith(provider);

    await service.indexIds('task', ['a', 'b']);

    const rows = repository.apply.mock.calls[0]?.[0] as { title: string; body: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toHaveLength(500);
    expect(rows[0]!.body).toHaveLength(4000);
    expect(rows[0]!.body.includes('\u0001')).toBe(false);
    expect(repository.remove).toHaveBeenCalledWith('task', 'b', validDate);
  });

  it('индексация несуществующего типа — no-op', async () => {
    const { repository, service } = serviceWith(null);
    await service.indexIds('task', ['a']);
    expect(repository.apply).not.toHaveBeenCalled();
  });

  it('бэкфилл: пачки до конца, пустая страница с курсором — защита от цикла', async () => {
    const scan = vi
      .fn()
      .mockResolvedValueOnce({ rows: [sourceRow()], next: { sourceUpdatedAt: validDate, id: 'a' } })
      .mockResolvedValueOnce({ rows: [], next: { sourceUpdatedAt: validDate, id: 'a' } });
    const provider = { scan } as unknown as SearchSourceProvider;
    const { repository, service } = serviceWith(provider);

    const processed = await service.scan('task');

    expect(processed).toBe(1);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan).toHaveBeenNthCalledWith(1, null, 500);
    expect(repository.apply).toHaveBeenCalledTimes(2);
    expect(repository.apply).toHaveBeenNthCalledWith(2, []);
  });

  it('бэкфилл отсутствующего провайдера — 0', async () => {
    const { service } = serviceWith(null);
    expect(await service.scan('task')).toBe(0);
  });

  it('removeIds удаляет строки проекции без обращения к провайдеру (#101)', async () => {
    const { repository, service } = serviceWith(null);
    await service.removeIds('employee', ['u1', 'u1', 'u2']);
    expect(repository.remove).toHaveBeenCalledTimes(2);
    expect(repository.remove).toHaveBeenCalledWith('employee', 'u1', expect.any(Date));
    expect(repository.remove).toHaveBeenCalledWith('employee', 'u2', expect.any(Date));
  });
});
