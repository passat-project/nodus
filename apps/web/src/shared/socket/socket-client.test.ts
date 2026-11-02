// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  CHAT_EVENTS,
  CUSTOM_FIELD_CATALOG_EVENTS,
  DICTIONARY_CATALOG_EVENTS,
  PROJECT_CATALOG_EVENTS,
  TASK_EVENTS,
  WORKFLOW_CATALOG_EVENTS,
} from '@nodus/contracts';

import { DOMAIN_EVENTS, isFirstDelivery } from './socket-client.js';

/**
 * Дедуп доставки message_sent (#254): gateway fanout шлёт событие и в
 * conv-комнату, и в user-комнаты участников — клиент в открытой беседе
 * получает одно сообщение дважды; уведомления срабатывают только на первую
 * копию (иначе 2 попапа оболочки / 2 браузерных тоста на одно сообщение).
 */

const CONV = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-000000000002';

function messagePayload(id: string) {
  return {
    conversationId: CONV,
    messageId: id,
    seq: 1,
    authorId: OTHER,
    threadRootId: null,
    forwarded: false,
    urgent: false,
    mentionedUserIds: [],
    message: {
      id,
      conversationId: CONV,
      seq: 1,
      clientMessageId: `cli-${id}`,
      author: { id: OTHER, displayName: 'Иван Петрович Смирнов', avatarUrl: null },
      text: 'привет',
      replyToId: null,
      reply: null,
      deletedAt: null,
      pinned: false,
      forwardedFrom: null,
      threadRootId: null,
      threadRepliesCount: 0,
      reactions: [],
      attachments: [],
      editedAt: null,
      readAt: null,
      readBy: [],
      urgent: false,
      mentionedUserIds: [],
      linkPreview: null,
      createdAt: new Date().toISOString(),
    },
  };
}

describe('isFirstDelivery (дедуп fanout conv+user)', () => {
  it('первая копия — да, повтор той же — нет, другое сообщение — да', () => {
    const a = messagePayload('00000000-0000-4000-8000-0000000000a1');
    const b = messagePayload('00000000-0000-4000-8000-0000000000b2');
    expect(isFirstDelivery(a)).toBe(true);
    // Дубль доставки (conv-комната + user-комната) — гасится.
    expect(isFirstDelivery(structuredClone(a))).toBe(false);
    expect(isFirstDelivery(structuredClone(a))).toBe(false);
    // Другое сообщение — своя первая доставка.
    expect(isFirstDelivery(b)).toBe(true);
  });

  it('кривой payload не занимает место в дедупе', () => {
    expect(isFirstDelivery({ мусор: true })).toBe(true);
    expect(isFirstDelivery(null)).toBe(true);
    // Валидное сообщение после мусора — первая доставка как обычно.
    expect(isFirstDelivery(messagePayload('00000000-0000-4000-8000-0000000000c3'))).toBe(true);
  });
});

describe('DOMAIN_EVENTS: подписка клиента (gotcha #311, #318)', () => {
  // Событие без строки в списке до роутера инвалидаций не доходит — молча
  // теряется (так жили task.* до #311 и стикеры до #318). Новое событие
  // каталога chat/task обязано быть подписано или явно исключено здесь.
  it('каждое событие каталогов chat.* и task.* подписано', () => {
    const subscribed = new Set<string>(DOMAIN_EVENTS);
    const missing = [...Object.values(CHAT_EVENTS), ...Object.values(TASK_EVENTS)].filter(
      (type) => !subscribed.has(type),
    );
    expect(missing).toEqual([]);
  });

  // F6 (#556): каталожные события «Атрибутов», справочников, «Процессов» и
  // видов папок gateway рассылает всем, но до роутера инвалидаций они не
  // доходили — подписки не было.
  it('каждое каталожное событие (атрибуты, справочники, процессы, виды папок) подписано', () => {
    const subscribed = new Set<string>(DOMAIN_EVENTS);
    const missing = [
      ...CUSTOM_FIELD_CATALOG_EVENTS,
      ...DICTIONARY_CATALOG_EVENTS,
      ...WORKFLOW_CATALOG_EVENTS,
      ...PROJECT_CATALOG_EVENTS,
    ].filter((type) => !subscribed.has(type));
    expect(missing).toEqual([]);
  });
});
