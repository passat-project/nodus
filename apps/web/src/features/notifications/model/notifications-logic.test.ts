import { describe, expect, it } from 'vitest';
import type { Notification, NotificationSnapshot } from '@nodus/contracts';

import { formatCount, groupNotifications, sortAttentionGroups } from './group-notifications.js';
import { PERSONAL_TOAST_CAP, shouldToast } from './toast-store.js';

const AUTHOR = '11111111-1111-1111-1111-111111111111';
const ME = '22222222-2222-2222-2222-222222222222';
const CONV = '33333333-3333-3333-3333-333333333333';
const CONV2 = '44444444-4444-4444-4444-444444444444';
const THREAD = '55555555-5555-5555-5555-555555555555';

function notif(n: number, overrides: Partial<Notification> = {}): Notification {
  return {
    id: `n${n}`,
    seq: n,
    priority: 'high',
    kind: 'chat.mention',
    sourceType: 'conversation',
    sourceId: CONV,
    actor: { id: AUTHOR, displayName: 'Автор', avatarUrl: null },
    preview: 'текст',
    urgentText: null,
    conversationId: CONV,
    conversationTitle: 'Беседа',
    messageId: `m${n}`,
    threadRootId: null,
    createdAt: new Date(Date.now() - n * 60_000).toISOString(),
    readAt: null,
    ackAt: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<NotificationSnapshot> = {}): NotificationSnapshot {
  return {
    notificationId: 'n1',
    userId: ME,
    priority: 'high',
    kind: 'chat.mention',
    sourceId: CONV,
    conversationId: CONV,
    conversationTitle: 'Беседа',
    messageId: 'm1',
    threadRootId: null,
    preview: 'текст',
    actorName: 'Автор',
    ...overrides,
  };
}

const NO_FLAGS = {
  viewerId: ME,
  openConversationId: null,
  openThread: null,
  muted: new Set<string>(),
  snoozed: new Set<string>(),
  dnd: { enabled: false, start: '22:00', end: '08:00' },
  userActive: true,
  now: new Date('2026-10-01T12:00:00'),
};

describe('groupNotifications (E4)', () => {
  it('10 сообщений одного чата — одна группа со счётчиком', () => {
    const groups = groupNotifications(
      Array.from({ length: 10 }, (_, i) => notif(i + 1, { conversationId: CONV, sourceId: CONV })),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(10);
    expect(groups[0]!.latest.id).toBe('n1');
  });

  it('разные чаты — разные группы; срочные не группируются', () => {
    const groups = groupNotifications([
      notif(1, { priority: 'urgent' }),
      notif(2, { priority: 'urgent' }),
      notif(3, { conversationId: CONV2, sourceId: CONV2 }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it('sortAttentionGroups: срочно → высокий → средний', () => {
    const sorted = sortAttentionGroups(
      groupNotifications([
        notif(1, { priority: 'medium', conversationId: CONV2, sourceId: CONV2 }),
        notif(2, { priority: 'high', conversationId: CONV, sourceId: CONV }),
        notif(3, { priority: 'urgent' }),
      ]),
    );
    expect(sorted.map((g) => g.latest.priority)).toEqual(['urgent', 'high', 'medium']);
  });

  it('formatCount: 999+ (E9)', () => {
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('999+');
    expect(formatCount(1200)).toBe('999+');
  });
});

describe('shouldToast (подавления B-кейсов)', () => {
  it('B1: высокоприоритетное — personal-тост', () => {
    expect(shouldToast(snapshot(), 0, NO_FLAGS)).toBe('personal');
  });

  it('B2/F4: низкий приоритет — никогда', () => {
    expect(
      shouldToast(snapshot({ priority: 'low', kind: 'chat.channel_post' }), 0, NO_FLAGS),
    ).toBeNull();
  });

  it('B3: muted-чат — нет (срочное пробивает)', () => {
    const ctx = { ...NO_FLAGS, muted: new Set([CONV]) };
    expect(shouldToast(snapshot(), 0, ctx)).toBeNull();
    expect(shouldToast(snapshot({ priority: 'urgent' }), 0, ctx)).toBe('personal');
  });

  it('B4: snoozed — тихо (журнал копится)', () => {
    const ctx = { ...NO_FLAGS, snoozed: new Set([CONV]) };
    expect(shouldToast(snapshot(), 0, ctx)).toBeNull();
  });

  it('B5/F6: DND глушит, срочное пробивается', () => {
    const ctx = { ...NO_FLAGS, dnd: { enabled: true, start: '11:00', end: '13:00' } };
    expect(shouldToast(snapshot(), 0, ctx)).toBeNull();
    expect(shouldToast(snapshot({ priority: 'urgent' }), 0, ctx)).toBe('personal');
  });

  it('DND окно через полночь', () => {
    const ctx = { ...NO_FLAGS, dnd: { enabled: true, start: '22:00', end: '08:00' } };
    const late = { ...ctx, now: new Date('2026-10-01T23:30:00') };
    const early = { ...ctx, now: new Date('2026-10-01T06:00:00') };
    const day = { ...ctx, now: new Date('2026-10-01T14:00:00') };
    expect(shouldToast(snapshot(), 0, late)).toBeNull();
    expect(shouldToast(snapshot(), 0, early)).toBeNull();
    expect(shouldToast(snapshot(), 0, day)).toBe('personal');
  });

  it('B6: открытый активный чат — только счётчики', () => {
    const ctx = { ...NO_FLAGS, openConversationId: CONV };
    expect(shouldToast(snapshot(), 0, ctx)).toBeNull();
    expect(shouldToast(snapshot({ conversationId: CONV2 }), 0, ctx)).toBe('personal');
    // пользователь отошёл (нет ввода/фокуса) — тост возвращается (#770)
    expect(shouldToast(snapshot(), 0, { ...ctx, userActive: false })).toBe('personal');
  });

  it('B6-тред (#1072): ответ в треде гасится только открытым окном ЭТОГО треда', () => {
    const reply = snapshot({ kind: 'chat.thread_reply', threadRootId: THREAD });
    const inChannel = { ...NO_FLAGS, openConversationId: CONV };
    // панель треда скрыта: нахожусь в канале, но ответов треда в ленте нет —
    // тост приходит (раньше глушился «открытой беседой»)
    expect(shouldToast(reply, 0, inChannel)).toBe('personal');
    // открыто окно именно этого треда — тишина
    const inThread = {
      ...NO_FLAGS,
      openConversationId: CONV,
      openThread: { conversationId: CONV, threadRootId: THREAD },
    };
    expect(shouldToast(reply, 0, inThread)).toBeNull();
    // открыто окно ДРУГОГО треда — тост приходит
    const inOtherThread = {
      ...NO_FLAGS,
      openConversationId: CONV,
      openThread: { conversationId: CONV, threadRootId: '00000000-0000-4000-8000-0000000000b1' },
    };
    expect(shouldToast(reply, 0, inOtherThread)).toBe('personal');
    // срочное пробивает и открытый тред
    expect(shouldToast(snapshot({ priority: 'urgent', threadRootId: THREAD }), 0, inThread)).toBe(
      'personal',
    );
  });

  it('B6-регресс: действие без беседы не гасится нулевым открытым чатом (null===null)', () => {
    const action = snapshot({
      priority: 'medium',
      kind: 'action.assignment',
      conversationId: null,
    });
    expect(shouldToast(action, 0, NO_FLAGS)).toBe('actions');
    const withOpen = { ...NO_FLAGS, openConversationId: CONV };
    expect(shouldToast(action, 0, withOpen)).toBe('actions');
  });

  it('F3: средний приоритет — сводная карточка', () => {
    expect(
      shouldToast(snapshot({ priority: 'medium', kind: 'action.assignment' }), 0, NO_FLAGS),
    ).toBe('actions');
  });

  it('чужие будила игнорируются', () => {
    expect(shouldToast(snapshot({ userId: 'other' }), 0, NO_FLAGS)).toBeNull();
  });

  it('F2: кап стака — 3 (предел десктопных попапов, #1038)', () => {
    expect(PERSONAL_TOAST_CAP).toBe(3);
  });
});
