import { describe, expect, it, vi } from 'vitest';

import { TaskRefReaderProvider } from './task-ref-reader.provider.js';

/**
 * Read-порт задач для ссылок атрибутов (Р5 #631): refs — пачкой из
 * `tasks` (мягко удалённые отдаются с `deleted`), visibleFor — та же
 * функция видимости, что у списка задач (участие + конфиденциальность +
 * надзор), наружу только интерфейс порта.
 */

const T1 = '00000000-0000-4000-8000-000000000501';
const T2 = '00000000-0000-4000-8000-000000000502';

const RESOLVED = {
  id: 'u1',
  permissions: [],
  subordinateIds: [],
  visibleProjectIds: [],
  hiddenProjectIds: [],
};

function make(rows: { id: string; title: string; deletedAt: Date | null }[], visible: boolean) {
  const prisma = { task: { findMany: vi.fn(async () => rows) } };
  const reads = { isVisible: vi.fn(async () => visible) };
  const viewers = { resolve: vi.fn(async () => RESOLVED) };
  const provider = new TaskRefReaderProvider(prisma as never, reads as never, viewers as never);
  return { provider, prisma, reads, viewers };
}

describe('TaskRefReaderProvider.refs (Р5 #631)', () => {
  it('пустой список — без запроса; мягко удалённая — deleted', async () => {
    const { provider, prisma } = make([], false);
    expect(await provider.refs([])).toEqual([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();

    const withRows = make(
      [
        { id: T1, title: 'Подобрать подрядчика', deletedAt: null },
        { id: T2, title: 'Запросить ТЗ', deletedAt: new Date('2026-10-30') },
      ],
      false,
    );
    expect(await withRows.provider.refs([T1, T2])).toEqual([
      { id: T1, name: 'Подобрать подрядчика', deleted: false },
      { id: T2, name: 'Запросить ТЗ', deleted: true },
    ]);
  });
});

describe('TaskRefReaderProvider.visibleFor (Р5 #631)', () => {
  it('viewer развязывается, задача проверяется фильтром видимости списка', async () => {
    const { provider, reads, viewers } = make([], true);
    const viewer = { id: 'u1', permissions: [] };
    expect(await provider.visibleFor(T1, viewer)).toBe(true);
    expect(viewers.resolve).toHaveBeenCalledWith(viewer);
    // Фильтр — visibleTasksWhere(resolved, 'all'): гейт deletedAt обязателен.
    expect(reads.isVisible).toHaveBeenCalledWith(T1, expect.objectContaining({ deletedAt: null }));

    const hidden = make([], false);
    expect(await hidden.provider.visibleFor(T1, viewer)).toBe(false);
  });
});
