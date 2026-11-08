import { ui } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { withoutPatronymic } from '../lib/format.js';
import { typingKey, useTypingStore } from '../socket/typing-store.js';
import { useConversations } from './chat-queries.js';

/** «печатает в обсуждении…» — по typing-записи ТРЕДА (ключ conv:root). */
export function useThreadTyping(conversationId: string, threadRootId: string): string | null {
  const meId = useAuthStore((s) => s.user?.id);
  const typing = useTypingStore((s) => s.entries[typingKey(conversationId, threadRootId)] ?? null);
  const { data } = useConversations();
  if (!typing || typing.expiresAt <= Date.now() || typing.userId === meId) return null;
  const name = data?.items
    .find((c) => c.id === conversationId)
    ?.membersPreview.find((m) => m.id === typing.userId)?.displayName;
  return name ? `${withoutPatronymic(name)} ${ui.chat.typingThread}` : ui.chat.typingThread;
}
