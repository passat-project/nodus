import { describe, expect, it, vi } from 'vitest';
import type { ConversationDraft } from '@nodus/contracts';

import type { ToolContext } from '../tool-definition.js';
import {
  chatAddMembersTool,
  chatCreateConversationTool,
  chatMembersTool,
  chatSaveDraftTool,
  chatSetMemberRoleTool,
} from './chat-actions.tools.js';

/** #929: беседы, участники, роли, черновик — карточка с именами, права API. */

const C = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';

const ctx: ToolContext = {
  authorization: 'Bearer t',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: vi.fn(async (path: string) => {
    if (path === `/chat/conversations/${C}`) return { id: C, title: 'Сметчики' };
    if (path === `/directory/users/${U}`) return { id: U, displayName: 'Петров Пётр' };
    return null;
  }),
};

describe('беседы и участники', () => {
  it('создание группы: тело по контракту, карточка с участниками', async () => {
    const input = { type: 'group' as const, title: 'Сметчики', memberIds: [U] };
    expect(chatCreateConversationTool.build!(input)).toEqual({
      method: 'POST',
      path: '/chat/conversations',
      body: { type: 'group', title: 'Сметчики', memberIds: [U] },
    });
    const fields = await chatCreateConversationTool.card!.fields(input, ctx);
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: 'Название', value: 'Сметчики' },
        { label: 'Тип', value: 'группа' },
        { label: 'Участники', value: 'Петров Пётр' },
      ]),
    );
    expect(chatCreateConversationTool.card!.undo).toBeUndefined();
  });

  it('добавление участников: names и отсутствие автоотмены', async () => {
    const input = { conversationId: C, userIds: [U] };
    expect(chatAddMembersTool.build!(input)).toEqual({
      method: 'POST',
      path: `/chat/conversations/${C}/members`,
      body: { userIds: [U] },
    });
    expect(await chatAddMembersTool.card!.summary(input, ctx)).toContain('Петров Пётр');
    expect(await chatAddMembersTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([{ label: 'Беседа', value: 'Сметчики' }]),
    );
  });

  it('роль участника: карточка и тело', async () => {
    const input = { conversationId: C, userId: U, role: 'admin' as const };
    expect(chatSetMemberRoleTool.build!(input)).toEqual({
      method: 'PATCH',
      path: `/chat/conversations/${C}/members/${U}`,
      body: { role: 'admin' },
    });
    expect(await chatSetMemberRoleTool.card!.summary(input, ctx)).toContain('модератор');
  });

  it('участники читаются декларативной проекцией', () => {
    const text = chatMembersTool.project!(
      {
        items: [
          {
            user: { id: U, displayName: 'Петров Пётр' },
            role: 'admin',
            joinedAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
      { id: C, limit: 50 },
    ).text;
    expect(text).toContain('Сотрудник: Петров Пётр');
    expect(text).toContain('Роль: admin');
    expect(text).toContain('В беседе с: 1 ноя 2026');
  });
});

describe('черновик', () => {
  it('сохраняется отдельным действием и не отправляется', async () => {
    const input = { conversationId: C, text: 'Добрый день!' };
    expect(chatSaveDraftTool.build!(input)).toEqual({
      method: 'PUT',
      path: `/chat/conversations/${C}/draft`,
      body: { text: 'Добрый день!' },
    });
    const draft = {
      text: 'Добрый день!',
      revision: 1,
      updatedAt: '2026-11-18T10:00:00.000Z',
    } as ConversationDraft;
    expect(chatSaveDraftTool.project!(draft, input).text).toContain('Черновик сохранён');
    expect(chatSaveDraftTool.card!.consequences).toContain('не отправляется');
  });
});
