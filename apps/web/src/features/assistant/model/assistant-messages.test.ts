import type { UserRef } from '@nodus/contracts';
import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_AUTHOR,
  ASSISTANT_CONVERSATION_ID,
  toChatMessage,
} from './assistant-messages.js';
import type { AssistantMessage } from './assistant-store.js';

const me: UserRef = { id: 'u1', displayName: 'Александр Климович', avatarUrl: null };

function msg(p: Partial<AssistantMessage>): AssistantMessage {
  return { id: 1, mine: false, text: 'текст', createdAt: '2026-11-16T10:00:00Z', ...p };
}

describe('маппинг сообщений концепта в канонический ChatMessage', () => {
  it('синтетический автор и беседа, валидные uuid и seq', () => {
    const m = toChatMessage(msg({ id: 7 }), me);
    expect(m.author).toEqual(ASSISTANT_AUTHOR);
    expect(m.conversationId).toBe(ASSISTANT_CONVERSATION_ID);
    expect(m.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(m.seq).toBe(7);
    expect(m.clientMessageId).toBe('assistant-7');
  });

  it('своё сообщение несёт автора-пользователя', () => {
    const m = toChatMessage(msg({ mine: true }), me);
    expect(m.author).toEqual(me);
  });

  it('без пользователя своё сообщение не падает и не становится чужим', () => {
    const m = toChatMessage(msg({ mine: true }), null);
    expect(m.author).toEqual(ASSISTANT_AUTHOR);
  });

  it('поля-заглушки канона: без реакций/вложений/надгробия/треда', () => {
    const m = toChatMessage(msg({}), me);
    expect(m.reactions).toEqual([]);
    expect(m.attachments).toEqual([]);
    expect(m.deletedAt).toBeNull();
    expect(m.reply).toBeNull();
    expect(m.threadRootId).toBeNull();
    expect(m.urgent).toBe(false);
    expect(m.text).toBe('текст');
    expect(m.createdAt).toBe('2026-11-16T10:00:00Z');
  });
});
