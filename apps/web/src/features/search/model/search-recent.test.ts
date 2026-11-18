// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { clearRecentSearches, loadRecentSearches, pushRecentSearch } from './search-recent.js';

describe('недавние запросы поиска (#952)', () => {
  beforeEach(() => localStorage.clear());

  it('хранятся на пользователя: чужой ключ не виден', () => {
    pushRecentSearch('user-a', 'труба');
    expect(loadRecentSearches('user-a')).toEqual(['труба']);
    expect(loadRecentSearches('user-b')).toEqual([]);
  });

  it('новые сверху, дубликаты без учёта регистра схлопываются', () => {
    pushRecentSearch('user-a', 'Труба');
    pushRecentSearch('user-a', 'галур');
    pushRecentSearch('user-a', 'труба');
    expect(loadRecentSearches('user-a')).toEqual(['труба', 'галур']);
  });

  it('короткий запрос (< 2) не сохраняется', () => {
    pushRecentSearch('user-a', 'т');
    expect(loadRecentSearches('user-a')).toEqual([]);
  });

  it('лимит 8 записей', () => {
    for (let index = 0; index < 12; index += 1) {
      pushRecentSearch('user-a', `запрос ${index}`);
    }
    expect(loadRecentSearches('user-a')).toHaveLength(8);
  });

  it('очистка убирает только свой список', () => {
    pushRecentSearch('user-a', 'труба');
    pushRecentSearch('user-b', 'смета');
    clearRecentSearches('user-a');
    expect(loadRecentSearches('user-a')).toEqual([]);
    expect(loadRecentSearches('user-b')).toEqual(['смета']);
  });

  it('битый JSON не роняет чтение', () => {
    localStorage.setItem('nodus-search-recent-v1:user-a', '{не json');
    expect(loadRecentSearches('user-a')).toEqual([]);
  });
});
