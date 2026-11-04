import { describe, expect, it, vi } from 'vitest';

import { LetterChatReaderProvider } from './letter-chat-reader.provider.js';

const LETTER = '00000000-0000-4000-8000-000000000301';
const ADDRESSEE = '00000000-0000-4000-8000-000000000302';
const REGISTRAR = '00000000-0000-4000-8000-000000000303';
const COLLEAGUE = '00000000-0000-4000-8000-000000000304';

function setup(
  row: { addresseeId: string | null; registeredAt: Date | null } | null,
  detail: Record<string, unknown> | null = null,
  deletedAt: Date | null = null,
) {
  const letters = {
    // Prisma-строка всегда несёт deletedAt; надгробие спама чат не открывает.
    chatRoster: vi.fn(async () => (row ? { ...row, deletedAt } : null)),
    findDetailById: vi.fn(async () => (detail ? { ...detail, deletedAt } : null)),
    participants: vi.fn(
      async (): Promise<{ userId: string; role: string; createdAt: Date }[]> => [],
    ),
  };
  const provider = new LetterChatReaderProvider(letters as never);
  return { provider, letters };
}

const participant = (userId: string, createdAt: Date) => ({
  userId,
  role: 'participant',
  createdAt,
});

describe('состав беседы письма (#55, Р10; редизайн #56)', () => {
  it('зарегистрированное: адресат — владелец, участники — члены', async () => {
    const { provider, letters } = setup({ addresseeId: ADDRESSEE, registeredAt: new Date() });
    letters.participants.mockResolvedValue([participant(REGISTRAR, new Date())]);
    const roster = await provider.roster(LETTER);
    expect(roster).toEqual({
      ownerId: ADDRESSEE,
      members: [{ userId: REGISTRAR, muted: false }],
    });
  });

  it('незарегистрированное с участниками: владелец — создатель (первый по времени)', async () => {
    const { provider, letters } = setup({ addresseeId: null, registeredAt: null });
    // Репозиторий отдаёт по createdAt asc — создатель обсуждения первый.
    letters.participants.mockResolvedValue([
      participant(REGISTRAR, new Date('2026-10-28T08:00:00Z')),
      participant(COLLEAGUE, new Date('2026-10-28T09:00:00Z')),
    ]);
    const roster = await provider.roster(LETTER);
    expect(roster).toEqual({
      ownerId: REGISTRAR,
      members: [
        { userId: REGISTRAR, muted: false },
        { userId: COLLEAGUE, muted: false },
      ],
    });
  });

  it('незарегистрированное без участников и без письма — null', async () => {
    const empty = setup({ addresseeId: null, registeredAt: null });
    expect(await empty.provider.roster(LETTER)).toBeNull();
    const missing = setup(null);
    expect(await missing.provider.roster(LETTER)).toBeNull();
  });

  it('зарегистрированное без адресата — null', async () => {
    const { provider } = setup({ addresseeId: null, registeredAt: new Date() });
    expect(await provider.roster(LETTER)).toBeNull();
  });
});

describe('видимость чата письма (#461, Р4)', () => {
  it('конфиденциальное: участник обсуждения чат видит, посторонний — нет', async () => {
    const { provider, letters } = setup(null, {
      registeredAt: new Date('2026-10-01T08:00:00Z'),
      confidential: true,
      registrarId: REGISTRAR,
      addresseeId: ADDRESSEE,
    });
    letters.participants.mockResolvedValue([participant(COLLEAGUE, new Date())]);
    expect(await provider.canView(LETTER, { id: COLLEAGUE, permissions: [] })).toBe(true);
    expect(await provider.canView(LETTER, { id: 'stranger', permissions: [] })).toBe(false);
    expect(await provider.canView(LETTER, { id: REGISTRAR, permissions: [] })).toBe(true);
  });

  it('неконфиденциальное зарегистрированное видят все; нет письма — false', async () => {
    const open = setup(null, {
      registeredAt: new Date('2026-10-01T08:00:00Z'),
      confidential: false,
      registrarId: REGISTRAR,
      addresseeId: ADDRESSEE,
    });
    expect(await open.provider.canView(LETTER, { id: 'stranger', permissions: [] })).toBe(true);
    expect(await setup(null).provider.canView(LETTER, { id: 'stranger', permissions: [] })).toBe(
      false,
    );
  });
});

describe('надгробие спама (#461)', () => {
  it('беседа и видимость письма закрыты, как карточка (Р13)', async () => {
    const deleted = setup(
      { addresseeId: ADDRESSEE, registeredAt: new Date() },
      null,
      new Date('2026-10-30T10:00:00Z'),
    );
    expect(await deleted.provider.roster(LETTER)).toBeNull();
    const detail = setup(null, {
      registeredAt: new Date('2026-10-01T08:00:00Z'),
      confidential: false,
      registrarId: REGISTRAR,
      addresseeId: ADDRESSEE,
    });
    // canView читает findDetailById (надгробие — false).
    expect(await detail.provider.canView(LETTER, { id: 'stranger', permissions: [] })).toBe(true);
  });
});
