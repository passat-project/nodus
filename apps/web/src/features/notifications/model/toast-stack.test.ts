import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSnapshot } from '@nodus/contracts';

import { useNotificationsToastStore } from './toast-store.js';

/** B7/F2/F3 на самом сторе: «+1» при повторе того же чата ≤60 с, кап 4,
 *  сводная действий растёт одним контейнером. */
const ME = '22222222-2222-2222-2222-222222222222';
const CONV = '33333333-3333-3333-3333-333333333333';

function snap(n: number, overrides: Partial<NotificationSnapshot> = {}): NotificationSnapshot {
  return {
    notificationId: `n${n}`,
    userId: ME,
    priority: 'high',
    kind: 'chat.direct_message',
    sourceId: CONV,
    conversationId: CONV,
    conversationTitle: 'Беседа',
    messageId: `m${n}`,
    threadRootId: null,
    preview: `текст ${n}`,
    actorName: 'Автор',
    ...overrides,
  };
}

vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: { getState: () => ({ user: { id: ME } }) },
}));
vi.mock('../../../shared/chat/open-conversation.js', () => ({
  getOpenConversation: () => null,
}));

describe('toast-store push', () => {
  beforeEach(() => {
    useNotificationsToastStore.setState({
      personal: [],
      actions: { count: 0, latest: null },
      mutedConversations: new Set(),
      snoozedConversations: new Set(),
      dnd: { enabled: false, start: '22:00', end: '08:00' },
    });
  });

  it('B7: второе личное того же чата ≤60 с — «+1», не новый тост', () => {
    const s = useNotificationsToastStore.getState();
    s.push(snap(1), 0);
    s.push(snap(2), 0);
    const personal = useNotificationsToastStore.getState().personal;
    expect(personal).toHaveLength(1);
    expect(personal[0]!.count).toBe(2);
  });

  it('F2: кап 4 видимых — старейшее вытесняется', () => {
    const s = useNotificationsToastStore.getState();
    for (let i = 0; i < 6; i += 1) {
      s.push(snap(i, { conversationId: `c${i}`, sourceId: `c${i}` }), 0);
    }
    const personal = useNotificationsToastStore.getState().personal;
    expect(personal).toHaveLength(4);
    expect(personal[0]!.snapshot.conversationId).toBe('c2');
  });

  it('F3: средний приоритет — сводная карточка одним счётчиком', () => {
    const s = useNotificationsToastStore.getState();
    s.push(snap(1, { priority: 'medium', kind: 'action.assignment' }), 0);
    s.push(snap(2, { priority: 'medium', kind: 'action.approval' }), 0);
    const { personal, actions } = useNotificationsToastStore.getState();
    expect(personal).toHaveLength(0);
    expect(actions.count).toBe(2);
  });

  it('срочные не стекаются попарно — каждая отдельно', () => {
    const s = useNotificationsToastStore.getState();
    s.push(snap(1, { priority: 'urgent', kind: 'urgent.message' }), 0);
    s.push(snap(2, { priority: 'urgent', kind: 'urgent.message' }), 0);
    expect(useNotificationsToastStore.getState().personal).toHaveLength(2);
  });
});

describe('toast-store syncWithAttention (#616)', () => {
  beforeEach(() => {
    useNotificationsToastStore.setState({
      personal: [],
      actions: { count: 0, latest: null },
      mutedConversations: new Set(),
      snoozedConversations: new Set(),
      dnd: { enabled: false, start: '22:00', end: '08:00' },
    });
  });

  it('внимание угасло — сводная карточка гаснет (не висит бесконечно)', () => {
    const s = useNotificationsToastStore.getState();
    s.push(snap(1, { priority: 'medium', kind: 'letter.arrived', conversationId: null }), 0);
    expect(useNotificationsToastStore.getState().actions.count).toBe(1);
    // Письмо открыли: журнал больше не требует внимания.
    s.syncWithAttention(0);
    expect(useNotificationsToastStore.getState().actions.count).toBe(0);
  });

  it('внимание осталось — карточка живёт', () => {
    const s = useNotificationsToastStore.getState();
    s.push(snap(1, { priority: 'medium', kind: 'letter.arrived', conversationId: null }), 0);
    s.syncWithAttention(1);
    expect(useNotificationsToastStore.getState().actions.count).toBe(1);
  });

  it('пустая сводка — no-op (лишних ре-рендеров нет)', () => {
    const s = useNotificationsToastStore.getState();
    const before = useNotificationsToastStore.getState().actions;
    s.syncWithAttention(0);
    expect(useNotificationsToastStore.getState().actions).toBe(before);
  });
});
