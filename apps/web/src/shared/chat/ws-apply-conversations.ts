import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { ChatMessageReadPayload, ConversationListItem, Paginated } from '@nodus/contracts';

import { chatKeys } from './chat-keys.js';

/** Патч списка бесед после чужой квитанции (#799): у СВОЕГО последнего
 *  сообщения, покрытого upToSeq и ещё не прочитанного, выставляем readAt —
 *  галка в строке списка становится «прочитано» без рефетча. readAt — момент
 *  ПЕРВОГО прочитавшего (канон #102): уже заполненную метку не трогаем.
 *  Патч живёт в ОБОИХ формах кэша списка: обычный Paginated и infinite-вкладки
 *  scoped (#252). Вынесен из `ws-apply.ts` отдельной ответственностью (I5). */
export function patchConversationReadAt(
  queryClient: QueryClient,
  payload: Pick<ChatMessageReadPayload, 'conversationId' | 'upToSeq' | 'readAt'>,
  meId: string | null,
): void {
  const { conversationId, upToSeq, readAt } = payload;
  const patchItems = (items: ConversationListItem[]): ConversationListItem[] =>
    items.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const last = conversation.lastMessage;
      if (
        last === null ||
        last.author.id !== meId ||
        last.deletedAt !== null ||
        last.seq > upToSeq ||
        last.readAt !== null
      ) {
        return conversation;
      }
      return { ...conversation, lastMessage: { ...last, readAt } };
    });
  queryClient.setQueryData<Paginated<ConversationListItem>>(chatKeys.conversations(), (old) =>
    old ? { ...old, items: patchItems(old.items) } : old,
  );
  for (const scope of ['chats', 'entities'] as const) {
    queryClient.setQueryData<InfiniteData<Paginated<ConversationListItem>>>(
      chatKeys.scoped(scope),
      (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({ ...page, items: patchItems(page.items) })),
            }
          : old,
    );
  }
}
