import { describe, expect, it } from 'vitest';

import type { ToolContext } from '../tool-definition.js';
import { chatDirectMessageTool } from './chat-write.tools.js';

/**
 * Личное сообщение (#921): find-or-create чата + отправка — одной карточкой.
 * Первый шаг идемпотентен id карточки, отправка — его суффиксом `:2`;
 * «Отменить» удаляет отправленное сообщение из найденного/созданного чата.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';

const ctx = {
  authorization: 'Bearer token',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: async () => ({ id: USER_ID, displayName: 'Ночная Анна' }),
} as ToolContext;

describe('chat.direct_message: личный чат и сообщение (#921)', () => {
  it('первый шаг — find-or-create личного чата, второй — отправка', () => {
    expect(chatDirectMessageTool.build!({ userId: USER_ID, text: 'Привет' })).toEqual({
      method: 'POST',
      path: `/chat/conversations/direct/${USER_ID}`,
    });
    expect(
      chatDirectMessageTool.followUp!({ id: CONVERSATION_ID }, { userId: USER_ID, text: 'Привет' }),
    ).toEqual({
      method: 'POST',
      path: `/chat/conversations/${CONVERSATION_ID}/messages`,
      body: { text: 'Привет' },
    });
    expect(chatDirectMessageTool.followUp!({}, { userId: USER_ID, text: 'Привет' })).toBeNull();
    // Ответ отправки несёт conversationId — второго сообщения не будет.
    expect(
      chatDirectMessageTool.followUp!(
        { id: MESSAGE_ID, conversationId: CONVERSATION_ID },
        { userId: USER_ID, text: 'Привет' },
      ),
    ).toBeNull();
  });

  it('project: ссылка на беседу и id сообщения', () => {
    const { text, entity } = chatDirectMessageTool.project!(
      { id: MESSAGE_ID },
      { userId: USER_ID, text: 'Привет' },
      [{ id: CONVERSATION_ID, title: 'Ночная Анна' }, { id: MESSAGE_ID }],
    );
    expect(text).toContain('Личное сообщение отправлено');
    expect(text).toContain(MESSAGE_ID);
    expect(entity).toEqual({
      href: `?cards=messenger:${CONVERSATION_ID}`,
      label: 'Ночная Анна',
    });
  });

  it('карточка: кому, текст, пометка про создание чата', async () => {
    const summary = await chatDirectMessageTool.card!.summary(
      { userId: USER_ID, text: 'Привет' },
      ctx,
    );
    expect(summary).toContain('Ночная Анна');
    const fields = await chatDirectMessageTool.card!.fields(
      { userId: USER_ID, text: 'Привет' },
      ctx,
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: 'Кому', value: 'Ночная Анна' },
        { label: 'Текст', value: 'Привет' },
        { label: 'Чат', value: 'существующий личный чат или будет создан' },
      ]),
    );
  });

  it('undo: удаляет отправленное сообщение из чата, созданного первым шагом', () => {
    expect(
      chatDirectMessageTool.card!.undo!(
        { userId: USER_ID, text: 'Привет' },
        { steps: [{ id: CONVERSATION_ID }, { id: MESSAGE_ID }], result: { id: MESSAGE_ID } },
      ),
    ).toEqual({
      method: 'DELETE',
      path: `/chat/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}`,
    });
    expect(
      chatDirectMessageTool.card!.undo!({ userId: USER_ID, text: 'Привет' }, { steps: [] }),
    ).toBeNull();
  });
});
