import { describe, expect, it, vi } from 'vitest';

import { LetterAttachedRefsValidator } from './letter-attached-refs.validator.js';

const CP = 'd0000000-0000-4000-8000-000000000001';
const CP2 = 'd0000000-0000-4000-8000-000000000002';

function setup(active = true) {
  const counterparties = {
    activeRef: vi.fn(async (id: string) => (active ? { id, name: 'АО «Галургия»' } : null)),
  };
  return new LetterAttachedRefsValidator(counterparties as never);
}

const row = (overrides: Record<string, unknown> = {}) => ({
  number: '456',
  counterpartyId: CP,
  date: '2026-10-18',
  ...overrides,
});

describe('строки «приложенных писем» (#461, Р3)', () => {
  it('организация — контрагент справочника; дата — в колонку DATE', async () => {
    const validator = setup();
    const rows = await validator.validate([
      row(),
      row({ number: '78', counterpartyId: CP2, date: null }),
    ]);
    expect(rows).toEqual([
      {
        number: '456',
        counterpartyId: CP,
        letterDate: new Date('2026-10-18T00:00:00.000Z'),
      },
      { number: '78', counterpartyId: CP2, letterDate: null },
    ]);
  });

  it('точный дубль строки — 422 duplicate (регистр номера не спасает)', async () => {
    await expect(setup().validate([row(), row({ number: '456' })])).rejects.toMatchObject({
      details: { reason: 'duplicate' },
    });
  });

  it('другой контрагент — не дубль: строка с тем же номером допустима', async () => {
    const rows = await setup().validate([row(), row({ counterpartyId: CP2 })]);
    expect(rows).toHaveLength(2);
  });

  it('контрагент не найден (архив/удалён) — 422 not_found', async () => {
    await expect(setup(false).validate([row()])).rejects.toMatchObject({
      details: { field: 'attachedRefs', reason: 'not_found' },
    });
  });
});
