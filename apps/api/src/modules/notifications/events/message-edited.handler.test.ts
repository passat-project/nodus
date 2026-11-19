import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_EVENTS } from '@nodus/contracts';

import { MessageEditedHandler } from './message-edited.handler.js';
import { NotificationsService } from '../notifications.service.js';

const CONV = '11111111-1111-1111-1111-111111111111';
const AUTHOR = '22222222-2222-2222-2222-222222222222';
const ALICE = '33333333-3333-3333-3333-333333333333';
const MSG = '44444444-4444-4444-4444-444444444444';
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
    createdAt: '2026-10-03T00:00:00Z',
  } as never;
}

const state = {
  type: 'group' as const,
  title: 'Проект',
  members: [
    { userId: AUTHOR, muted: false },
    { userId: ALICE, muted: false },
  ],
};

describe('MessageEditedHandler', () => {
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
      conversation_title: 'Проект',
      message_id: MSG,
      thread_root_id: null,
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

  it('создаёт журнал и эмитит dispatch на каждую созданную строку', async () => {
    await handler.handle(makeEvent());
    expect(repo.createFromEvent).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      NOTIFICATION_EVENTS.DISPATCH_REQUESTED,
      expect.objectContaining({
        attempt: 0,
        snapshot: expect.objectContaining({ userId: ALICE, actorName: 'Автор Правок' }),
      }),
      expect.objectContaining({ aggregateType: 'notification' }),
    );
  });

  it('редактор не получает уведомление о своей правке', async () => {
    await handler.handle(makeEvent());
    const event = service.buildInsertsFromEditedEvent.mock.calls[0]!;
    const stateArg = event[1] as typeof state;
    expect(stateArg.members.map((m) => m.userId)).toContain(AUTHOR);
    const inserts = service.buildInsertsFromEditedEvent.mock.results[0]!.value as Array<{
      user_id: string;
    }>;
    expect(inserts.map((i) => i.user_id)).toEqual([ALICE]);
  });

  it('правка в треде (#974): наблюдатели берутся у треда, якорь треда — в сборку', async () => {
    const ROOT = '77777777-7777-7777-7777-777777777777';
    service.threadWatcherIds.mockResolvedValue([ALICE]);
    await handler.handle(makeEvent({ threadRootId: ROOT }));

    expect(service.threadWatcherIds).toHaveBeenCalledWith(ROOT);
    expect(service.buildInsertsFromEditedEvent.mock.calls[0]?.[2]).toEqual([ALICE]);
    expect(service.buildInsertsFromEditedEvent.mock.calls[0]?.[0]).toMatchObject({
      payload: expect.objectContaining({ threadRootId: ROOT }),
    });
  });

  it('правка сообщения ленты: наблюдатели треда не запрашиваются (#974)', async () => {
    await handler.handle(makeEvent());

    expect(service.threadWatcherIds).not.toHaveBeenCalled();
    expect(service.buildInsertsFromEditedEvent.mock.calls[0]?.[2]).toEqual([]);
  });

  it('повторная доставка события (0 созданных) — эмитов нет', async () => {
    repo.createFromEvent.mockResolvedValue([]);
    await handler.handle(makeEvent());
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('флаг notifications выключен — тишина (чат жив)', async () => {
    featureFlags.isEnabled.mockResolvedValue(false);
    await handler.handle(makeEvent());
    expect(repo.createFromEvent).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('устаревший payload (без authorId/seq, до #189) — тихий пропуск', async () => {
    await handler.handle(makeEvent({ authorId: undefined, seq: undefined }));
    expect(service.conversationState).not.toHaveBeenCalled();
    expect(repo.createFromEvent).not.toHaveBeenCalled();
  });

  it('беседа исчезла — тихий выход без ошибки', async () => {
    service.conversationState.mockResolvedValue(null);
    await expect(handler.handle(makeEvent())).resolves.toBeUndefined();
    expect(repo.createFromEvent).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.buildInsertsFromEditedEvent', () => {
  const svc = new NotificationsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('всем членам кроме редактора; kind/превью/watermark из события', () => {
    const inserts = svc.buildInsertsFromEditedEvent(
      {
        id: EVENT_ID,
        payload: {
          conversationId: CONV,
          messageId: MSG,
          authorId: AUTHOR,
          text: 'Новый текст',
          seq: 9,
        },
      },
      state,
    );
    expect(inserts.map((i) => i.user_id)).toEqual([ALICE]);
    expect(inserts[0]).toMatchObject({
      priority: 'low',
      kind: 'chat.message_edited',
      source_seq: 9n,
      actor_id: AUTHOR,
      preview: 'Новый текст',
      conversation_title: 'Проект',
      event_id: EVENT_ID,
    });
  });

  it('превью режется до PREVIEW_MAX', () => {
    const long = 'а'.repeat(500);
    const inserts = svc.buildInsertsFromEditedEvent(
      {
        id: EVENT_ID,
        payload: { conversationId: CONV, messageId: MSG, authorId: AUTHOR, text: long, seq: 9 },
      },
      state,
    );
    expect(inserts[0]!.preview!.length).toBe(160);
    expect(inserts[0]!.urgent_text).toBeNull();
  });

  /** #239: дифф множеств упоминаний при правке. */
  it('НОВЫЙ упомянутый → chat.mention (high); прежний/без упоминания → message_edited (low)', () => {
    const inserts = svc.buildInsertsFromEditedEvent(
      {
        id: EVENT_ID,
        payload: {
          conversationId: CONV,
          messageId: MSG,
          authorId: AUTHOR,
          text: 'Текст с @[Алиса](user:…)',
          seq: 9,
          mentionedUserIds: [ALICE],
          previousMentionedUserIds: [],
        },
      },
      state,
    );
    const alice = inserts.find((i) => i.user_id === ALICE)!;
    expect(alice).toMatchObject({ kind: 'chat.mention', priority: 'high' });
  });

  it('упомянутый в ПРЕДЫДУЩЕЙ версии (в т.ч. убрали-вернули) → НЕ дёргается упоминанием', () => {
    const inserts = svc.buildInsertsFromEditedEvent(
      {
        id: EVENT_ID,
        payload: {
          conversationId: CONV,
          messageId: MSG,
          authorId: AUTHOR,
          text: 'Текст',
          seq: 9,
          mentionedUserIds: [ALICE],
          previousMentionedUserIds: [ALICE],
        },
      },
      state,
    );
    const alice = inserts.find((i) => i.user_id === ALICE)!;
    expect(alice).toMatchObject({ kind: 'chat.message_edited', priority: 'low' });
  });

  /** Вердикт владельца 10.10: замена @Все на ЛИЧНЫЙ тэг — высший приоритет
   *  (broadcast в истории НЕ глушит первый личный тэг). */
  it('«@Все → @Анна»: Анне chat.mention (high), broadcast-соседям — low', () => {
    const inserts = svc.buildInsertsFromEditedEvent(
      {
        id: EVENT_ID,
        payload: {
          conversationId: CONV,
          messageId: MSG,
          authorId: AUTHOR,
          text: 'Текст с @Анной',
          seq: 9,
          // Новая версия: прямой тэг Анны (expanded = [ALICE]).
          mentionedUserIds: [ALICE],
          // История: только broadcast «Все» — личных тэгов не было.
          previousMentionedUserIds: [],
          previousMentionedAll: true,
          directMentionedUserIds: [ALICE],
        },
      },
      state,
    );
    const alice = inserts.find((i) => i.user_id === ALICE)!;
    expect(alice).toMatchObject({ kind: 'chat.mention', priority: 'high' });
  });

  it('«@Все остался»: повторный broadcast никого не пингает (low всем)', () => {
    const inserts = svc.buildInsertsFromEditedEvent(
      {
        id: EVENT_ID,
        payload: {
          conversationId: CONV,
          messageId: MSG,
          authorId: AUTHOR,
          text: 'Текст',
          seq: 9,
          mentionedUserIds: [ALICE], // expanded «Все» покрывает Анну
          previousMentionedUserIds: [],
          previousMentionedAll: true,
          directMentionedUserIds: [], // личных тэгов в новой версии нет
        },
      },
      state,
    );
    expect(inserts.every((i) => i.kind === 'chat.message_edited')).toBe(true);
  });

  it('правка ДОБАВИЛА @Все (первый broadcast): участникам high', () => {
    const inserts = svc.buildInsertsFromEditedEvent(
      {
        id: EVENT_ID,
        payload: {
          conversationId: CONV,
          messageId: MSG,
          authorId: AUTHOR,
          text: 'Текст',
          seq: 9,
          mentionedUserIds: [ALICE],
          previousMentionedUserIds: [],
          previousMentionedAll: false,
          directMentionedUserIds: [],
        },
      },
      state,
    );
    const alice = inserts.find((i) => i.user_id === ALICE)!;
    expect(alice).toMatchObject({ kind: 'chat.mention', priority: 'high' });
  });

  it('payload без множеств (события до #239) → прежнее поведение: все edited (low)', () => {
    const inserts = svc.buildInsertsFromEditedEvent(
      {
        id: EVENT_ID,
        payload: {
          conversationId: CONV,
          messageId: MSG,
          authorId: AUTHOR,
          text: 'Текст',
          seq: 9,
          mentionedUserIds: [],
          previousMentionedUserIds: [],
        },
      },
      state,
    );
    expect(inserts.every((i) => i.kind === 'chat.message_edited')).toBe(true);
  });

  /** #974: правка ответа в обсуждении — только наблюдателям треда. */
  describe('правка в треде (#974)', () => {
    const BOB = '99999999-9999-9999-9999-999999999999';
    const ROOT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const wideState = {
      type: 'project_channel' as const,
      title: 'Новости',
      members: [
        { userId: AUTHOR, muted: false },
        { userId: ALICE, muted: false },
        { userId: BOB, muted: false },
      ],
    };

    it('приходит только наблюдателю, thread_root_id заполнен', () => {
      const inserts = svc.buildInsertsFromEditedEvent(
        {
          id: EVENT_ID,
          payload: {
            conversationId: CONV,
            messageId: MSG,
            authorId: AUTHOR,
            text: 'Правка в обсуждении',
            seq: 9,
            threadRootId: ROOT,
          },
        },
        wideState,
        [ALICE],
      );
      expect(inserts.map((i) => i.user_id)).toEqual([ALICE]);
      expect(inserts[0]).toMatchObject({ kind: 'chat.message_edited', thread_root_id: ROOT });
    });

    it('новый @упомянутый в правке треда получает high, даже если не наблюдатель', () => {
      const inserts = svc.buildInsertsFromEditedEvent(
        {
          id: EVENT_ID,
          payload: {
            conversationId: CONV,
            messageId: MSG,
            authorId: AUTHOR,
            text: 'Текст с @[Боб](user:…)',
            seq: 9,
            threadRootId: ROOT,
            mentionedUserIds: [BOB],
            previousMentionedUserIds: [],
          },
        },
        wideState,
        [ALICE],
      );
      expect(inserts.find((i) => i.user_id === ALICE)).toMatchObject({
        kind: 'chat.message_edited',
      });
      expect(inserts.find((i) => i.user_id === BOB)).toMatchObject({
        kind: 'chat.mention',
        priority: 'high',
        thread_root_id: ROOT,
      });
    });

    it('правка ленты — прежняя аудитория, thread_root_id пуст', () => {
      const inserts = svc.buildInsertsFromEditedEvent(
        {
          id: EVENT_ID,
          payload: {
            conversationId: CONV,
            messageId: MSG,
            authorId: AUTHOR,
            text: 'Правка поста',
            seq: 9,
          },
        },
        wideState,
      );
      expect(inserts.map((i) => i.user_id)).toEqual([ALICE, BOB]);
      expect(inserts.every((i) => i.thread_root_id === null)).toBe(true);
    });
  });
});
