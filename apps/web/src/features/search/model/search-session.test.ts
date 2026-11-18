// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { resetSessionState } from '../../../shared/session-reset.js';
import { startSearchSession } from './search-session.js';
import { useSearchStore } from './search-store.js';

/**
 * #952 (AUD-005): строка и фильтры поиска принадлежат пользователю, а не
 * вкладке. После смены пользователя чужой запрос не остаётся в поле и не
 * уходит в API/аналитику под новым аккаунтом.
 */
beforeEach(() => {
  useSearchStore.setState({
    open: true,
    query: 'Иванов увольнение',
    types: ['task'],
    projectId: 'project-1',
    period: 'year',
    sort: 'newest',
  });
  // Подписку на смену пользователя в приложении включает оболочка.
  startSearchSession();
});

describe('сессия поиска (#952)', () => {
  it('смена пользователя очищает строку, фильтры и открытое окно', () => {
    resetSessionState('user-a');
    expect(useSearchStore.getState()).toMatchObject({
      open: false,
      query: '',
      types: [],
      projectId: null,
      period: 'any',
      sort: 'relevance',
    });
  });
});
