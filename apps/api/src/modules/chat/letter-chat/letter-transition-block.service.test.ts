import { CORRESPONDENCE_EVENTS } from '@nodus/contracts';
import { describe, expect, it, vi } from 'vitest';

import { LetterTransitionBlockService } from './letter-transition-block.service.js';

const LETTER = '00000000-0000-4000-8000-000000000421';
const ACTOR = '00000000-0000-4000-8000-000000000422';
const CONVERSATION = '00000000-0000-4000-8000-000000000423';

const payload = {
  letterId: LETTER,
  fromStageId: 'from',
  toStageId: 'to',
  toStageName: 'Не зарегистрировано',
  fromState: 'backlog' as const,
  toState: 'closed' as const,
  toStageOutcome: 'cancelled' as const,
  transitionId: 'tr',
  cause: 'transition' as const,
  recordId: 'rec',
  transitionName: 'Закрыть без регистрации',
  fromStageName: 'Новое',
  comment: 'ошибочный скан',
  commentLabel: 'Причина',
};

function event(overrides: Record<string, unknown> = {}, actorId: string | null = ACTOR) {
  return {
    id: 'event-1',
    type: CORRESPONDENCE_EVENTS.LETTER_STAGE_CHANGED,
    payload: { ...payload, ...overrides },
    actorId,
  } as never;
}

function setup(options: { member?: boolean } = {}) {
  const writes = {
    allocateSeqs: vi.fn(async () => 5n),
    insertMessage: vi.fn(async () => ({
      id: 'msg-1',
      conversationId: CONVERSATION,
      seq: 5n,
      text: payload.comment,
    })),
    touchLastMessageAt: vi.fn(async () => void 0),
  };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const conversations = {
    listMembers: vi.fn(async () => (options.member === false ? [] : [{ userId: ACTOR }])),
  };
  const service = new LetterTransitionBlockService(
    { run: (fn: (tx: unknown) => unknown) => fn({}) } as never,
    { sync: vi.fn(async () => CONVERSATION) } as never,
    writes as never,
    { toFreshDto: vi.fn(async () => ({ id: 'msg-1' })) } as never,
    conversations as never,
    { revealHidden: vi.fn(async () => void 0) } as never,
    { applyMessageSent: vi.fn(async () => void 0) } as never,
    { emit: vi.fn(async () => void 0) } as never,
    { isEnabled: vi.fn(async () => true) } as never,
    { stagesByIds: vi.fn(async () => [{ id: 'to', color: 'danger' }]) } as never,
    logger as never,
  );
  return { service, writes, conversations, logger };
}

describe('блок перехода письма в чате (#55, Р10)', () => {
  it('пишет letter_transition с цветом цели и ключом идемпотентности', async () => {
    const { service, writes } = setup();
    await service.post(event());
    expect(writes.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'letter_transition',
        text: 'ошибочный скан',
        clientMessageId: 'letter-transition:event-1',
        payload: expect.objectContaining({
          kind: 'letter_transition',
          letterId: LETTER,
          toStageName: 'Не зарегистрировано',
          toStageColor: 'danger',
          commentLabel: 'Причина',
        }),
      }),
      expect.anything(),
    );
  });

  it('без причины блок не пишется (регистрация причины не несёт)', async () => {
    const { service, writes } = setup();
    await service.post(event({ comment: undefined }));
    expect(writes.insertMessage).not.toHaveBeenCalled();
  });

  it('системная запись без актора и без журнала — не блок', async () => {
    const { service, writes } = setup();
    await service.post(event({ recordId: undefined }));
    expect(writes.insertMessage).not.toHaveBeenCalled();
    await service.post(event({}, null));
    expect(writes.insertMessage).not.toHaveBeenCalled();
  });

  it('повторная доставка outbox не дублирует сообщение', async () => {
    const { service, writes } = setup();
    writes.insertMessage.mockResolvedValueOnce(null as never);
    await service.post(event());
    expect(writes.touchLastMessageAt).not.toHaveBeenCalled();
  });

  it('актор вне беседы письма — блок не пишется (#741)', async () => {
    const { service, writes, logger } = setup({ member: false });
    await service.post(event());
    expect(writes.insertMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
