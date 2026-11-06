import { describe, expect, it, vi } from 'vitest';

import { LetterRefReaderProvider } from './letter-ref-reader.provider.js';

/**
 * Read-порт писем для ссылок атрибутов (Р5 #631): имя «№ · корреспондент»
 * одним запросом каждой таблицы, надгробие спама — `deleted`, видимость —
 * делегируется существующему порту #461.
 */

const L1 = '00000000-0000-4000-8000-000000000301';
const L2 = '00000000-0000-4000-8000-000000000302';
const L3 = '00000000-0000-4000-8000-000000000303';
const CP = '00000000-0000-4000-8000-000000000311';

function make(
  letters: {
    id: string;
    regNumber: string | null;
    counterpartyId: string | null;
    deletedAt: Date | null;
  }[],
  counterparties: { id: string; shortName: string }[] = [],
  visible = new Set<string>(),
) {
  const prisma = {
    letter: { findMany: vi.fn(async () => letters) },
    counterparty: { findMany: vi.fn(async () => counterparties) },
  };
  const visibility = { visibleLetterIds: vi.fn(async () => visible) };
  const provider = new LetterRefReaderProvider(prisma as never, visibility as never);
  return { provider, prisma, visibility };
}

describe('LetterRefReaderProvider.refs (Р5 #631)', () => {
  it('пустой список — быстрый выход без запросов', async () => {
    const { provider, prisma } = make([]);
    expect(await provider.refs([])).toEqual([]);
    expect(prisma.letter.findMany).not.toHaveBeenCalled();
  });

  it('имя «№ · корреспондент»; без номера — прочерк, без контрагента — только номер', async () => {
    const { provider, prisma } = make(
      [
        { id: L1, regNumber: 'Вх-2026/118', counterpartyId: CP, deletedAt: null },
        { id: L2, regNumber: null, counterpartyId: null, deletedAt: new Date('2026-10-30') },
      ],
      [{ id: CP, shortName: 'ПассатПроект' }],
    );
    expect(await provider.refs([L1, L2])).toEqual([
      { id: L1, name: 'Вх-2026/118 · ПассатПроект', deleted: false },
      { id: L2, name: '—', deleted: true },
    ]);
    // Контрагенты — пачкой уникальных id, одним запросом.
    expect(prisma.counterparty.findMany).toHaveBeenCalledWith({
      where: { id: { in: [CP] } },
      select: { id: true, shortName: true },
    });
  });

  it('контрагент исчез из таблицы — имя без него, чип не ломается', async () => {
    const { provider } = make(
      [{ id: L3, regNumber: 'Вх-2026/9', counterpartyId: CP, deletedAt: null }],
      [],
    );
    expect(await provider.refs([L3])).toEqual([{ id: L3, name: 'Вх-2026/9', deleted: false }]);
  });
});

describe('LetterRefReaderProvider.visibleFor (#461)', () => {
  it('делегирует порту видимости и различает круг доступа', async () => {
    const { provider, visibility } = make([], [], new Set([L1]));
    const viewer = { id: 'u1', permissions: [] };
    expect(await provider.visibleFor(L1, viewer)).toBe(true);
    expect(await provider.visibleFor(L2, viewer)).toBe(false);
    expect(visibility.visibleLetterIds).toHaveBeenCalledTimes(2);
    expect(visibility.visibleLetterIds).toHaveBeenCalledWith([L1], viewer);
  });
});
