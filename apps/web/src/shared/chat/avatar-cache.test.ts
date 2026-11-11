import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { invalidateChatAvatarCaches } from './avatar-cache.js';
import { chatKeys } from './chat-keys.js';
import { usersListKey } from '../api/users-list.js';

/**
 * Смена личного фото (#726): кэш чата (ленты/треды с копией `author.avatarUrl`,
 * списки бесед, участники) сбрасывается единым хелпером мутаций аватара.
 * Справочник людей тут НЕ дублируется — его инвалидирует сама мутация
 * (`directoryKeys.all`), поэтому проверяем обе стороны границы.
 */

describe('invalidateChatAvatarCaches — единая точка для кэша чата (#726)', () => {
  it('сбрасывает весь кэш чата', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    invalidateChatAvatarCaches(client);

    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(chatKeys.all);
  });

  it('справочник людей не трогает: это ключ directory, его сбрасывает мутация', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');

    invalidateChatAvatarCaches(client);

    const keys = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).not.toContainEqual(usersListKey);
  });
});
