import type { ChatMessage, UserRef } from '@nodus/contracts';

import type { AssistantMessage } from './assistant-store.js';

/** Ассистент — не сотрудник: постоянный синтетический автор диалога.
 *  Карточку сотрудника по его аватару не открываем (глиф рисует хост). */
export const ASSISTANT_AUTHOR: UserRef = {
  id: '00000000-0000-4000-8000-0000000000a1',
  displayName: 'Ассистент',
  avatarUrl: null,
};

/** Синтетическая беседа диалога (мок-конвейер, не серверная запись). */
export const ASSISTANT_CONVERSATION_ID = '00000000-0000-4000-8000-0000000000c0';

function messageId(id: number): string {
  return `00000000-0000-4000-8000-${id.toString(16).padStart(12, '0')}`;
}

/** Сообщения концепта → канонический ChatMessage: лента рендерится ТЕМИ ЖЕ
 *  компонентами, что мессенджер (серии, пузыри, хвосты, мета) — сообщение
 *  остаётся единой сущностью во всех хостах рендера. */
export function toChatMessage(m: AssistantMessage, me: UserRef | null): ChatMessage {
  return {
    id: messageId(m.id),
    conversationId: ASSISTANT_CONVERSATION_ID,
    seq: m.id,
    clientMessageId: `assistant-${m.id}`,
    author: m.mine && me ? me : ASSISTANT_AUTHOR,
    text: m.text,
    replyToId: null,
    reply: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [],
    attachments: [],
    editedAt: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    readAt: null,
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: m.createdAt,
  };
}
