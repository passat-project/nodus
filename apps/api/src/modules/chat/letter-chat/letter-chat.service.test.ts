import { describe, expect, it, vi } from 'vitest';

import { LetterChatService } from './letter-chat.service.js';

const LETTER = '00000000-0000-4000-8000-000000000201';
const OWNER = '00000000-0000-4000-8000-000000000202';
const MEMBER = '00000000-0000-4000-8000-000000000203';
const STRANGER = '00000000-0000-4000-8000-000000000204';
const CONVERSATION = '00000000-0000-4000-8000-000000000205';

function setup(roster: unknown) {
  const repo = {
    find: vi.fn<() => Promise<string | null>>(async () => CONVERSATION),
    findOrCreate: vi.fn(async () => ({ id: CONVERSATION, created: true })),
    lock: vi.fn(async () => void 0),
    members: vi.fn<() => Promise<string[]>>(async () => []),
    addMembers: vi.fn(async (_tx: unknown, _id: string, members: { userId: string }[]) =>
      members.map((member) => member.userId),
    ),
    removeMembers: vi.fn(async () => void 0),
  };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const order: string[] = [];
  const letters = {
    roster: vi.fn(async () => {
      order.push('roster');
      return roster;
    }),
    canView: vi.fn(async () => true),
  };
  const service = new LetterChatService(
    repo as never,
    {
      run: (fn: (tx: unknown) => unknown) => {
        order.push('tx');
        return fn({});
      },
    } as never,
    eventBus as never,
    letters as never,
  );
  return { service, repo, eventBus, letters, order };
}

const ROSTER = { ownerId: OWNER, members: [{ userId: MEMBER, muted: false }] };

describe('чат письма (#55, Р10)', () => {
  it('состав = адресат (owner) + участники (member)', async () => {
    const { service, repo, eventBus } = setup(ROSTER);
    repo.find.mockResolvedValueOnce(null);
    await service.sync(LETTER, OWNER);
    expect(repo.addMembers).toHaveBeenCalledWith(expect.anything(), CONVERSATION, [
      { userId: OWNER, role: 'owner', muted: false },
      { userId: MEMBER, role: 'member', muted: false },
    ]);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.anything(),
      'chat.conversation_created',
      expect.objectContaining({ type: 'letter' }),
      expect.anything(),
    );
  });

  it('письмо без беседы (незарегистрированное без участников): roster null', async () => {
    const { service, repo } = setup(null);
    expect(await service.sync(LETTER, OWNER)).toBeNull();
    expect(repo.findOrCreate).not.toHaveBeenCalled();
  });

  it('выбывший теряет членство (история остаётся)', async () => {
    const { service, repo } = setup({ ownerId: OWNER, members: [] });
    repo.members.mockResolvedValue([OWNER, MEMBER]);
    await service.sync(LETTER, OWNER);
    expect(repo.removeMembers).toHaveBeenCalledWith(expect.anything(), CONVERSATION, [MEMBER]);
  });

  it('не участник — 404 без оракула', async () => {
    const { service } = setup(ROSTER);
    await expect(
      service.openForUser(LETTER, { id: STRANGER, permissions: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('состав читается ДО открытия транзакции (AUD-022), под локом — гейт #252', async () => {
    const { service, order } = setup(ROSTER);
    await service.sync(LETTER, OWNER);
    const txIndex = order.indexOf('tx');
    expect(order.slice(0, txIndex)).toEqual(['roster']);
    expect(order.slice(txIndex)).toEqual(['tx', 'roster']);
  });
});
