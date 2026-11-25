import type { QueryClient } from '@tanstack/react-query';
import type { ConversationListItem } from '@nodus/contracts';

import { chatKeys } from './chat-keys.js';

/**
 * Одиночные строки беседы (#1051). Беседа задачи, письма, проекта, личка по
 * сотруднику и выборка deep-link лежат в кэше отдельными ключами под кустом
 * `chatKeys.conversations()` — это та же строка, что в списке, но читается
 * точечным запросом (беседа задачи/письма — find-or-create с транзакцией на
 * чтение). Событие ЛЮБОЙ беседы прежде перечитывало весь куст; теперь списки
 * обновляются по событию любой беседы, а строки — только по событию своей:
 * значок непрочитанного на вкладке чата карточки задачи остаётся живым, чужие
 * беседы его не трогают.
 */

const isRow = (data: unknown): data is ConversationListItem =>
  typeof data === 'object' &&
  data !== null &&
  'id' in data &&
  !('items' in data) &&
  !('pages' in data);

/** Ключи строк этой беседы в кэше (пусто — ни одна витрина её не держит). */
export function conversationRowKeys(
  queryClient: QueryClient,
  conversationId: string,
): (readonly unknown[])[] {
  const keys: (readonly unknown[])[] = [];
  for (const query of queryClient.getQueryCache().findAll({ queryKey: chatKeys.conversations() })) {
    const row = query.state.data;
    if (isRow(row) && row.id === conversationId) keys.push(query.queryKey);
  }
  return keys;
}

/** Прочитано — строкам на месте, без запроса: счётчик гаснет, отметка чтения
 *  двигается вперёд (отставшая квитанция её не откатывает). Летящий перезапрос
 *  строки отменяется: он отвечал бы «непрочитано» поверх погашенного. */
export function patchConversationRowsRead(
  queryClient: QueryClient,
  conversationId: string,
  upToSeq?: number,
): void {
  for (const key of conversationRowKeys(queryClient, conversationId)) {
    void queryClient.cancelQueries({ queryKey: key, exact: true });
    queryClient.setQueryData<ConversationListItem>(key, (row) => {
      if (!row) return row;
      const read = { ...row, unreadCount: 0 };
      return upToSeq === undefined
        ? read
        : { ...read, myLastReadSeq: Math.max(row.myLastReadSeq, upToSeq) };
    });
  }
}
