import type { ConversationListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { plural, withoutPatronymic } from '../lib/format.js';
import { useAuthStore } from '../auth-store.js';
import { useIsOnline } from '../socket/presence-store.js';
import { useTypingStore } from '../socket/typing-store.js';
import { conversationSubtitle, directPeer, isNotesConversation } from './conversations.js';

/**
 * Живая подпись беседы — ЕДИНАЯ точка (ревизия #211 05.10): бар беседы и
 * панель-профиль показывают одну логику (typing > direct presence >
 * «N участников» > типовая), без дублей. Экспорт для conversation-bar
 * (кнопка «N участников») и chat-profile-pane (статичный текст).
 */

/** Собеседник личного чата — логика в `conversations.ts` (её же берёт аватар
 *  беседы, #726); имя оставлено для существующих потребителей. */
export const findPeer = directPeer;

export function memberName(conversation: ConversationListItem, userId: string): string | null {
  const raw = conversation.membersPreview.find((member) => member.id === userId)?.displayName;
  return raw ? withoutPatronymic(raw) : null;
}

/** Подзаголовок: typing > direct presence > «N участников» (кнопка, #186;
 *  без onOpenMembers — статичный текст, ревизия #211 05.10) > типовой. */
export function buildSubtitle(
  conversation: ConversationListItem,
  meId: string | undefined,
  live: {
    typingName: string | null;
    peerOnline: boolean;
    onOpenMembers?: () => void;
  },
) {
  if (live.typingName !== null) {
    // Direct — просто «печатает…»; группа/канал — «Имя печатает…».
    return conversation.type === 'direct' || live.typingName === ''
      ? ui.chat.typing
      : `${live.typingName} ${ui.chat.typing}`;
  }
  if (conversation.type === 'direct' && !isNotesConversation(conversation, meId)) {
    return live.peerOnline ? ui.common.online : ui.chat.offline;
  }
  // Чат задачи — как группа (вердикт владельца 16.10, #252): число участников.
  if (
    conversation.type === 'group' ||
    conversation.type === 'project_channel' ||
    conversation.type === 'task'
  ) {
    const count = conversation.membersCount;
    const label = `${count} ${plural(count, [
      ui.chat.membersCountOne,
      ui.chat.membersCountFew,
      ui.chat.membersCountMany,
    ])}`;
    return live.onOpenMembers ? (
      <button
        type="button"
        onClick={live.onOpenMembers}
        className="-mx-1 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        title={ui.chat.membersPanelTitle}
      >
        {label}
      </button>
    ) : (
      label
    );
  }
  return conversationSubtitle(conversation);
}

/** Живая подпись беседы для панели-профиля: та же логика, что у бара,
 *  без кнопки участников. Хуки — безусловно, беседы может не быть в кэше. */
export function useConversationSubtitle(conversation: ConversationListItem | null) {
  const meId = useAuthStore((s) => s.user?.id);
  const typing = useTypingStore((s) =>
    conversation ? (s.entries[conversation.id] ?? null) : null,
  );
  const typingVisible = typing !== null && typing.expiresAt > Date.now() && typing.userId !== meId;
  const peer = conversation && conversation.type === 'direct' ? findPeer(conversation, meId) : null;
  const peerOnline = useIsOnline(peer?.id);
  if (!conversation) return '';
  const typingName = typingVisible ? memberName(conversation, typing.userId) : null;
  return buildSubtitle(conversation, meId, { typingName, peerOnline });
}
