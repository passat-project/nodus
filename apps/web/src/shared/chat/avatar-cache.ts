import type { QueryClient } from '@tanstack/react-query';

import { chatKeys } from './chat-keys.js';

/**
 * После смены/удаления ЛИЧНОГО фото (#726) обновляем кэш чата: в DTO
 * сообщения лежит КОПИЯ `author.avatarUrl`, а списки бесед и участники —
 * собственные снапшоты справочника. Без этого старые пузыри и строки бесед
 * жили со старым фото до F5.
 *
 * Справочник людей (`usersListKey`) здесь НЕ дублируется: он лежит под
 * ключом `directory`, и мутации аватара инвалидируют его сами
 * (`directoryKeys.all` в `features/directory/api/directory-api.ts`) — этого
 * достаточно топбару, пикерам и панели участников (`usePersonAvatarUrl`).
 */
export function invalidateChatAvatarCaches(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: chatKeys.all });
}
