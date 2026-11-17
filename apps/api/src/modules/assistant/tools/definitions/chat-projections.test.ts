import { describe, expect, it } from 'vitest';

import { chatConversationsTool, chatMessagesTool } from './chat.tools.js';

/**
 * Проекции мессенджера (#892, #896): беседа отдаёт `membersPreview` и
 * `lastActivityAt` (несуществующих `members`/`lastMessageAt` в контракте
 * нет), сообщения — автора, время, обрезанный текст и имена вложений.
 */

const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444';

describe('chat.conversations: беседы сотрудника (#892)', () => {
  it('строка беседы: название, тип, непрочитанные, активность, id', () => {
    const { text } = chatConversationsTool.project!(
      {
        items: [
          {
            id: CONVERSATION_ID,
            title: 'Проектировщики',
            type: 'group',
            unreadCount: 4,
            lastActivityAt: '2026-02-11T15:30:00.000Z',
            membersPreview: [{ displayName: 'Иванов Иван' }],
          },
        ],
        nextCursor: 'c2',
      },
      { scope: 'all', limit: 20 },
    );
    expect(text).toContain('Беседы: 1');
    expect(text).toContain('Проектировщики, тип group, непрочитанных 4');
    expect(text).toContain('активность 11 фев 2026, 15:30');
    expect(text).toContain(`id ${CONVERSATION_ID}`);
    expect(text).toContain('есть следующая страница (cursor)');
  });

  it('без названия — список участников из превью; без прочитанных/активности — без них', () => {
    const { text } = chatConversationsTool.project!(
      {
        items: [
          {
            id: CONVERSATION_ID,
            title: null,
            type: 'direct',
            unreadCount: 0,
            lastActivityAt: null,
            membersPreview: [{ displayName: 'Иванов Иван' }, { name: 'Петров Пётр' }, null],
          },
          { id: 'x', type: 'direct', membersPreview: [] },
          { type: 'direct' },
          null,
        ],
      },
      {},
    );
    expect(text).toContain('Иванов Иван, Петров Пётр, тип direct');
    expect(text).toContain('Беседа, тип direct');
    expect(text).not.toContain('непрочитанных');
    expect(text).not.toContain('активность');
  });

  it('запрос передаёт scope и поиск только при наличии', () => {
    expect(chatConversationsTool.build!({ scope: 'chats', search: 'смета', limit: 5 })).toEqual({
      path: '/chat/conversations',
      query: { scope: 'chats', limit: '5', search: 'смета' },
    });
    expect(chatConversationsTool.build!({ scope: 'all', limit: 20 })).toEqual({
      path: '/chat/conversations',
      query: { scope: 'all', limit: '20' },
    });
  });

  it('личная переписка: scope=direct + имя собеседника, следующая страница по cursor', () => {
    // Личный чат живёт в общем списке по активности и на большом аккаунте
    // уходит за первую страницу (живой разбор 17.11: 51 беседа с Анной,
    // личная — 48-я). Поэтому точечный фильтр и пагинация — не роскошь.
    expect(chatConversationsTool.build!({ scope: 'direct', search: 'Анна', limit: 20 })).toEqual({
      path: '/chat/conversations',
      query: { scope: 'direct', limit: '20', search: 'Анна' },
    });
    expect(chatConversationsTool.build!({ scope: 'chats', cursor: 'c2', limit: 20 })).toEqual({
      path: '/chat/conversations',
      query: { scope: 'chats', limit: '20', cursor: 'c2' },
    });
  });
});

describe('chat.messages: сообщения беседы (#892)', () => {
  it('строка сообщения: время, автор, обрезанный текст и имена вложений', () => {
    const { text, entity } = chatMessagesTool.project!(
      {
        items: [
          {
            author: { displayName: 'Иванов Иван' },
            createdAt: '2026-02-11T15:30:00.000Z',
            text: 'Согласовали смету, ждём подписи',
            attachments: [{ name: 'Смета.xlsx' }, { name: null }, null],
          },
          { author: null, createdAt: null, text: null, attachments: [] },
          null,
        ],
        nextCursor: 'c2',
      },
      { conversationId: CONVERSATION_ID, limit: 20 },
    );
    expect(text).toContain('Сообщения беседы: 2');
    expect(text).toContain('11 фев 2026, 15:30 Иванов Иван: Согласовали смету, ждём подписи');
    expect(text).toContain('[вложения: Смета.xlsx]');
    expect(text).toContain('— —: (без текста)');
    expect(text).toContain('есть следующая страница (cursor)');
    expect(entity).toEqual({ href: `?cards=messenger:${CONVERSATION_ID}`, label: 'Беседа' });
    expect(chatMessagesTool.build!({ conversationId: CONVERSATION_ID, limit: 30 })).toEqual({
      path: `/chat/conversations/${CONVERSATION_ID}/messages`,
      query: { limit: '30' },
    });
  });

  it('длинный текст обрезается с пометкой', () => {
    const { text } = chatMessagesTool.project!(
      {
        items: [{ author: { displayName: 'Иванов' }, createdAt: null, text: 'слово '.repeat(120) }],
      },
      { conversationId: CONVERSATION_ID, limit: 20 },
    );
    expect(text).toContain('[сокращено]');
  });
});
