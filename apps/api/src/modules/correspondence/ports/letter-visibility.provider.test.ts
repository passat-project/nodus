import { describe, expect, it, vi } from 'vitest';

import { LetterVisibilityProvider } from './letter-visibility.provider.js';

const OPEN = '00000000-0000-4000-8000-000000000601';
const DELETED = '00000000-0000-4000-8000-000000000602';
const SECRET = '00000000-0000-4000-8000-000000000603';

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  registeredAt: new Date('2026-10-01T08:00:00Z'),
  confidential: false,
  registrarId: 'u-registrar',
  addresseeId: null,
  deletedAt: null,
  ...overrides,
});

describe('видимость писем для CRM-счётчика (#461, Р4)', () => {
  it('надгробие не считается; конфиденциальное — только участнику', async () => {
    const letters = {
      visibilityRows: vi.fn(async () => [
        row(OPEN),
        row(DELETED, { deletedAt: new Date('2026-10-30T10:00:00Z') }),
        row(SECRET, { confidential: true }),
      ]),
      participantsOf: vi.fn(async () => [{ letterId: SECRET, userId: 'u1' }]),
    };
    const provider = new LetterVisibilityProvider(letters as never);
    const visible = await provider.visibleLetterIds([OPEN, DELETED, SECRET], {
      id: 'u1',
      permissions: [],
    });
    expect([...visible].sort()).toEqual([OPEN, SECRET].sort());
    const stranger = await provider.visibleLetterIds([OPEN, DELETED, SECRET], {
      id: 'u2',
      permissions: [],
    });
    expect([...stranger]).toEqual([OPEN]);
  });
});
