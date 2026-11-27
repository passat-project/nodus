import { describe, expect, it, vi } from 'vitest';

import {
  chatConversationUrl,
  messengerTabForType,
  messengerTabSearch,
  resolveChatTab,
  stageMessengerConversation,
  stageMessengerThread,
  subscribeMessengerConversation,
  subscribeMessengerThread,
  takeMessengerConversation,
  takeMessengerThread,
} from './messenger-nav.js';

/** Пристройка треда к мессенджер-карточке (#300): одноразовое потребление +
 *  подписка живой карточки (клик по уведомлению при уже открытой карточке). */

const CONV = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';
const THREAD = '00000000-0000-4000-8000-000000000071';

describe('messenger-nav', () => {
  it('потребление одноразовое и только своей беседы', () => {
    expect(takeMessengerThread(OTHER)).toBe(null);
    stageMessengerThread(CONV, THREAD);
    expect(takeMessengerThread(OTHER)).toBe(null);
    expect(takeMessengerThread(CONV)).toBe(THREAD);
    expect(takeMessengerThread(CONV)).toBe(null);
  });

  it('подписка живой карточки срабатывает на пристойку её беседы', () => {
    const seen: (string | null)[] = [];
    const unsub = subscribeMessengerThread(() => seen.push(takeMessengerThread(CONV)));
    stageMessengerThread(OTHER, THREAD); // чужая беседа — колбэк молчит (null)
    expect(seen).toEqual([null]);
    stageMessengerThread(CONV, THREAD);
    expect(seen).toEqual([null, THREAD]); // потреблено сразу, no-op openCard не мешает
    unsub();
    stageMessengerThread(CONV, THREAD); // после отписки — ждёт нового потребителя
    expect(takeMessengerThread(CONV)).toBe(THREAD);
  });

  it('отписка снимает слушателя', () => {
    const fn = vi.fn();
    const unsub = subscribeMessengerThread(fn);
    unsub();
    stageMessengerThread(CONV, THREAD);
    expect(fn).not.toHaveBeenCalled();
    takeMessengerThread(CONV);
  });

  it('пристойка беседы: одноразовая, только своя и с подпиской (#719)', () => {
    expect(takeMessengerConversation(OTHER)).toBe(false);
    stageMessengerConversation(CONV);
    expect(takeMessengerConversation(OTHER)).toBe(false);
    expect(takeMessengerConversation(CONV)).toBe(true);
    expect(takeMessengerConversation(CONV)).toBe(false);

    const fn = vi.fn();
    const unsub = subscribeMessengerConversation(fn);
    stageMessengerConversation(OTHER); // чужая — колбэк всё равно будит карточку
    expect(fn).toHaveBeenCalledTimes(1);
    expect(takeMessengerConversation(CONV)).toBe(false);
    expect(takeMessengerConversation(OTHER)).toBe(true);
    unsub();
    stageMessengerConversation(CONV);
    expect(fn).toHaveBeenCalledTimes(1);
    takeMessengerConversation(CONV);
  });

  it('вкладка внешнего открытия: задачи/письма → «Чаты задач», остальные → «Чаты» (#719)', () => {
    expect(messengerTabForType('task')).toBe('tasks');
    expect(messengerTabForType('letter')).toBe('tasks');
    expect(messengerTabForType('direct')).toBe('chats');
    expect(messengerTabForType('group')).toBe('chats');
    expect(messengerTabForType('project_channel')).toBe('chats');
  });

  it('адрес беседы несёт вкладку задачи/письма и тред (#1062)', () => {
    expect(chatConversationUrl(CONV, { type: 'task' })).toBe(`/chat/${CONV}?tab=tasks`);
    expect(chatConversationUrl(CONV, { type: 'letter', threadRootId: THREAD })).toBe(
      `/chat/${CONV}?tab=tasks&thread=${THREAD}`,
    );
    // Личные/групповые — канонический адрес без параметра; тред сохраняется.
    expect(chatConversationUrl(CONV, { type: 'direct' })).toBe(`/chat/${CONV}`);
    expect(chatConversationUrl(CONV, { type: 'group', threadRootId: THREAD })).toBe(
      `/chat/${CONV}?thread=${THREAD}`,
    );
  });

  it('search вкладки: задачи/письма → tab=tasks, остальные → без параметра (#1062)', () => {
    expect(messengerTabSearch('task')).toEqual({ tab: 'tasks' });
    expect(messengerTabSearch('letter')).toEqual({ tab: 'tasks' });
    expect(messengerTabSearch('direct')).toEqual({});
    expect(messengerTabSearch(undefined)).toEqual({});
  });

  it('resolveChatTab: явный ?tab= главнее, без него — тип беседы (#1062)', () => {
    expect(resolveChatTab('tasks', 'direct')).toBe('tasks');
    expect(resolveChatTab('settings', 'task')).toBe('settings');
    expect(resolveChatTab('chats', 'task')).toBe('chats');
    expect(resolveChatTab(undefined, 'task')).toBe('tasks');
    expect(resolveChatTab(undefined, 'letter')).toBe('tasks');
    expect(resolveChatTab(undefined, 'direct')).toBe('chats');
    expect(resolveChatTab(undefined, undefined)).toBe('chats');
  });
});
