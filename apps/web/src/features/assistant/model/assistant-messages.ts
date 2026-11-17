import type {
  AssistantMessage as AssistantMessageDto,
  ChatMessage,
  UserRef,
} from '@nodus/contracts';

/** Ассистент — не сотрудник: постоянный синтетический автор диалога.
 *  Карточку сотрудника по его аватару не открываем (глиф рисует хост). */
export const ASSISTANT_AUTHOR: UserRef = {
  id: '00000000-0000-4000-8000-0000000000a1',
  displayName: 'Ассистент',
  avatarUrl: null,
};

/** Синтетическая беседа диалога: лента рендерится каноном чатов, но это не
 *  серверная беседа мессенджера. */
export const ASSISTANT_CONVERSATION_ID = '00000000-0000-4000-8000-0000000000c0';

/** Сообщения ассистента → канонический ChatMessage: лента рисуется ТЕМИ ЖЕ
 *  компонентами, что мессенджер (серии, пузыри, хвосты, мета) — сообщение
 *  остаётся единой сущностью во всех хостах рендера. */
export function toChatMessage(m: AssistantMessageDto, me: UserRef | null): ChatMessage {
  const mine = m.role === 'user';
  return {
    id: m.id,
    conversationId: ASSISTANT_CONVERSATION_ID,
    seq: 1,
    clientMessageId: `assistant-${m.id}`,
    author: mine && me ? me : ASSISTANT_AUTHOR,
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
