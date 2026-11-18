// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useRecentSearches } from './use-recent-searches.js';

/** Недавние запросы поиска (#952): ключ на пользователя, push/clear, смена
 *  пользователя перечитывает свой список. */
beforeEach(() => localStorage.clear());

describe('недавние запросы поиска (#952)', () => {
  it('push добавляет запрос, смена пользователя читает свой ключ', () => {
    const { result, rerender } = renderHook(({ userId }) => useRecentSearches(userId), {
      initialProps: { userId: 'user-a' },
    });
    act(() => result.current.push('смета'));
    expect(result.current.items).toEqual(['смета']);

    rerender({ userId: 'user-b' });
    expect(result.current.items).toEqual([]);

    rerender({ userId: 'user-a' });
    expect(result.current.items).toEqual(['смета']);
  });

  it('clear стирает список пользователя', () => {
    const { result } = renderHook(() => useRecentSearches('user-a'));
    act(() => result.current.push('труба'));
    act(() => result.current.clear());
    expect(result.current.items).toEqual([]);
  });

  it('анонимный пользователь — пустой список без падения', () => {
    const { result } = renderHook(() => useRecentSearches(null));
    expect(result.current.items).toEqual([]);
  });
});
