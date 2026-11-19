import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageEditedHandler } from './message-edited.handler.js';

const CONV = '11111111-1111-1111-1111-111111111111';
const AUTHOR = '22222222-2222-2222-2222-222222222222';
const ALICE = '33333333-3333-3333-3333-333333333333';
const MSG = '44444444-4444-4444-4444-444444444444';
const ROOT = '77777777-7777-7777-7777-777777777777';
const EVENT_ID = '55555555-5555-5555-5555-555555555555';
const NOTIF_ID = '66666666-6666-6666-6666-666666666666';
const TX = 'tx-handle';

function makeEvent(payload: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    type: 'chat.message_edited',
    actorId: AUTHOR,
    payload: {
      conversationId: CONV,
      messageId: MSG,
      authorId: AUTHOR,
      text: 'Поправленный текст',
      seq: 7,
      ...payload,
    },
    createdAt: '2026-11-19T00:00:00Z',
  } as never;
}

const state = {
  type: 'project_channel' as const,
  title: 'Новости',
  members: [
    { userId: AUTHOR, muted: false },
    { userId: ALICE, muted: false },
  ],
};

/**
 * #974: правка ответа в обсуждении — уведомление только наблюдателям треда,
 * и в событии сборки есть якорь треда (клик открывает обсуждение).
 */
describe('MessageEditedHandler: тред (#974)', () => {
  const repo = { createFromEvent: vi.fn() };
  const service = {
    conversationState: vi.fn(),
    buildInsertsFromEditedEvent: vi.fn(),
    actorName: vi.fn(),
    threadWatcherIds: vi.fn<(rootId: string) => Promise<string[]>>(async () => []),
  };
  const txRunner = { run: vi.fn((cb: (tx: string) => unknown) => cb(TX)) };
  const eventBus = { emit: vi.fn() };
  const featureFlags = { isEnabled: vi.fn() };
  let handler: MessageEditedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    featureFlags.isEnabled.mockResolvedValue(true);
    service.conversationState.mockResolvedValue(state);
    service.actorName.mockResolvedValue('Автор Правок');
    const insert = {
      id: NOTIF_ID,
      user_id: ALICE,
      priority: 'low',
      kind: 'chat.message_edited',
      source_type: 'conversation',
      source_id: CONV,
      source_seq: 7n,
      actor_id: AUTHOR,
      preview: 'Поправленный текст',
      urgent_text: null,
      conversation_id: CONV,
      conversation_title: 'Новости',
      message_id: MSG,
      thread_root_id: ROOT,
      event_id: EVENT_ID,
    };
    service.buildInsertsFromEditedEvent.mockReturnValue([insert]);
    repo.createFromEvent.mockResolvedValue([
      {
        ...insert,
        seq: 1n,
        created_at: new Date(),
        read_at: null,
        ack_at: null,
        repeats_stopped_at: null,
      },
    ]);
    handler = new MessageEditedHandler(
      service as never,
      repo as never,
      txRunner as never,
      eventBus as never,
      featureFlags as never,
      { setContext: vi.fn(), debug: vi.fn() } as never,
    );
  });

  it('наблюдатели берутся у треда, якорь треда — в сборку', async () => {
    service.threadWatcherIds.mockResolvedValue([ALICE]);
    await handler.handle(makeEvent({ threadRootId: ROOT }));

    expect(service.threadWatcherIds).toHaveBeenCalledWith(ROOT);
    expect(service.buildInsertsFromEditedEvent.mock.calls[0]?.[2]).toEqual([ALICE]);
    expect(service.buildInsertsFromEditedEvent.mock.calls[0]?.[0]).toMatchObject({
      payload: expect.objectContaining({ threadRootId: ROOT }),
    });
  });

  it('правка сообщения ленты: наблюдатели треда не запрашиваются', async () => {
    await handler.handle(makeEvent());

    expect(service.threadWatcherIds).not.toHaveBeenCalled();
    expect(service.buildInsertsFromEditedEvent.mock.calls[0]?.[2]).toEqual([]);
  });
});
