import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../tool-definition.js';
import {
  chatEditMessageTool,
  chatForwardMessageTool,
  chatPinMessageTool,
  chatReactTool,
  chatUnpinMessageTool,
} from './chat-messages-actions.tools.js';

/** #929: действия с сообщениями — правка, закреп, реакция, пересылка. */

const C = '11111111-1111-4111-8111-111111111111';
const SRC = '22222222-2222-4222-8222-222222222222';
const M = '33333333-3333-4333-8333-333333333333';

const ctx: ToolContext = {
  authorization: 'Bearer t',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: vi.fn(async (path: string) => {
    if (path === `/chat/conversations/${C}`) return { id: C, title: 'Сметчики' };
    if (path === `/chat/conversations/${SRC}`) return { id: SRC, title: 'Приёмная' };
    if (path === `/chat/conversations/${C}/messages?limit=50`)
      return { items: [{ id: M, text: 'Старый текст' }], nextCursor: null };
    return null;
  }),
};

describe('правка сообщения', () => {
  it('карточка показывает текущий и новый текст, автоотмены нет', async () => {
    const input = { conversationId: C, messageId: M, text: 'Новый текст' };
    expect(chatEditMessageTool.build!(input)).toEqual({
      method: 'PATCH',
      path: `/chat/conversations/${C}/messages/${M}`,
      body: { text: 'Новый текст' },
    });
    expect(await chatEditMessageTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([
        { label: 'Было', value: 'Старый текст' },
        { label: 'Станет', value: 'Новый текст' },
      ]),
    );
    expect(chatEditMessageTool.card!.undo).toBeUndefined();
  });
});

describe('закреп и реакция', () => {
  it('закреп и откреп — отдельные действия, автоматической отмены нет', () => {
    const input = { conversationId: C, messageId: M };
    expect(chatPinMessageTool.build!(input)).toEqual({
      method: 'POST',
      path: `/chat/conversations/${C}/messages/${M}/pin`,
    });
    // Идемпотентный закреп: «Отменить» снял бы и чужой/прежний закреп.
    expect(chatPinMessageTool.card!.undo).toBeUndefined();
    expect(chatPinMessageTool.effect).toBe('irreversible');
    expect(chatUnpinMessageTool.build!(input)).toEqual({
      method: 'DELETE',
      path: `/chat/conversations/${C}/messages/${M}/pin`,
    });
  });

  it('реакция: явное действие без обратного undo (защита предсуществующей)', () => {
    const input = { conversationId: C, messageId: M, emoji: '👍' };
    expect(chatReactTool.build!(input)).toEqual({
      method: 'POST',
      path: `/chat/conversations/${C}/messages/${M}/reactions`,
      body: { emoji: '👍' },
    });
    expect(chatReactTool.card!.undo).toBeUndefined();
    expect(chatReactTool.effect).toBe('irreversible');
  });
});

describe('пересылка', () => {
  it('карточка называет обе беседы и число сообщений', async () => {
    const input = {
      conversationId: C,
      sourceConversationId: SRC,
      messageIds: [M],
      comment: 'Посмотрите',
    };
    expect(chatForwardMessageTool.build!(input)).toEqual({
      method: 'POST',
      path: `/chat/conversations/${C}/forward`,
      body: {
        sourceConversationId: SRC,
        messageIds: [M],
        comment: 'Посмотрите',
      },
    });
    const summary = await chatForwardMessageTool.card!.summary(input, ctx);
    expect(summary).toContain('«Приёмная»');
    expect(summary).toContain('«Сметчики»');
    expect(chatForwardMessageTool.project!([{ id: M }] as never, input).text).toContain(
      'Переслано сообщений: 1',
    );
  });
});
