import { describe, expect, it } from 'vitest';

import { NotificationsService } from '../notifications.service.js';

const CONV = '11111111-1111-1111-1111-111111111111';
const AUTHOR = '22222222-2222-2222-2222-222222222222';
const ALICE = '33333333-3333-3333-3333-333333333333';
const BOB = '99999999-9999-9999-9999-999999999999';
const MSG = '44444444-4444-4444-4444-444444444444';
const ROOT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EVENT_ID = '55555555-5555-5555-5555-555555555555';

const svc = new NotificationsService(
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
);

const wideState = {
  type: 'project_channel' as const,
  title: 'Новости',
  members: [
    { userId: AUTHOR, muted: false },
    { userId: ALICE, muted: false },
    { userId: BOB, muted: false },
  ],
};

/**
 * #974: правка ответа в обсуждении — только наблюдателям треда (как у
 * отправки); правка сообщения ленты — всем членам беседы. Якорь треда в
 * строке уведомления даёт клику открыть обсуждение.
 */
describe('buildInsertsFromEditedEvent: правка в треде (#974)', () => {
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
