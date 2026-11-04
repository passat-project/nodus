import { describe, expect, it, vi } from 'vitest';

import { LetterAttachedRefsValidator } from './letter-attached-refs.validator.js';

const CP = 'd0000000-0000-4000-8000-000000000001';

function setup(active = true) {
  const counterparties = {
    activeRef: vi.fn(async (id: string) => (active ? { id, name: 'АО «Галургия»' } : null)),
  };
  return new LetterAttachedRefsValidator(counterparties as never);
}

const row = (overrides: Record<string, unknown> = {}) => ({
  number: '456',
  counterpartyId: null,
  orgText: 'Беларуськалий',
  date: '2026-10-18',
  ...overrides,
});

describe('строки «приложенных писем» (#461, Р3)', () => {
  it('организация контрагентом или текстом; дата — в колонку DATE', async () => {
    const validator = setup();
    const rows = await validator.validate([
      row({ counterpartyId: CP, orgText: null }),
      row({ number: '78', date: null }),
    ]);
    expect(rows).toEqual([
      {
        number: '456',
        counterpartyId: CP,
        orgText: null,
        letterDate: new Date('2026-10-18T00:00:00.000Z'),
      },
      { number: '78', counterpartyId: null, orgText: 'Беларуськалий', letterDate: null },
    ]);
  });

  it('без организации — 422 required', async () => {
    await expect(setup().validate([row({ orgText: null })])).rejects.toMatchObject({
      code: 'LETTER_REGISTRATION_INVALID',
      details: { field: 'attachedRefs', reason: 'required' },
    });
  });

  it('точный дубль строки — 422 duplicate (регистр не спасает)', async () => {
    await expect(
      setup().validate([row({ orgText: 'Беларуськалий' }), row({ orgText: 'БЕЛАРУСЬКАЛИЙ' })]),
    ).rejects.toMatchObject({ details: { reason: 'duplicate' } });
  });

  it('контрагент не найден — 422 not_found', async () => {
    await expect(
      setup(false).validate([row({ counterpartyId: CP, orgText: null })]),
    ).rejects.toMatchObject({ details: { field: 'attachedRefs', reason: 'not_found' } });
  });
});
