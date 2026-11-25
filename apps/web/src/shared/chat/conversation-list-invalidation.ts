import type { QueryClient } from '@tanstack/react-query';

import { invalidateNow } from '../api/task-invalidate.js';
import { chatKeys } from './chat-keys.js';

/**
 * Списки бесед — точечно (#1051). Префикс `chatKeys.conversations()` накрывает
 * не только список и вкладки мессенджера, но и «тяжёлых соседей»: беседы
 * задач, писем и проектов (`by-task`/`by-letter`/`by-project` — на сервере это
 * find-or-create с транзакцией на КАЖДОЕ чтение), личные беседы по сотруднику
 * и выборку deep-link. Прежде любое событие любого чата рефечило весь куст:
 * на проде `GET /chat/conversations` вызывался 4350 раз за 14 часов, а при
 * открытой карточке задачи каждое чужое сообщение повторяло её синхронизацию
 * участников.
 *
 * Обновляют списки: сам список (превью, порядок по активности), вкладки
 * мессенджера, пикеры поиска и сводка непрочитанных по вкладкам.
 */
export function invalidateConversationLists(queryClient: QueryClient): void {
  const base = chatKeys.conversations();
  void invalidateNow(queryClient, base, { exact: true });
  void invalidateNow(queryClient, [...base, 'scope']);
  void invalidateNow(queryClient, [...base, 'search']);
  void invalidateNow(queryClient, chatKeys.unreadSummary());
}

/** Ключ куста бесед (им инвалидируют батчеры и мутации) — провести точечно. */
export function isConversationListsKey(key: readonly unknown[]): boolean {
  return JSON.stringify(key) === JSON.stringify(chatKeys.conversations());
}
