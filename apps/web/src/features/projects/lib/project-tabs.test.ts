import { describe, expect, it } from 'vitest';

import { PROJECT_TAB_IDS } from './project-tabs.js';

describe('вкладки карточки проекта', () => {
  it('системный порядок: «О проекте» после «Задач», «Структура» первой', () => {
    expect(PROJECT_TAB_IDS).toEqual([
      'structure',
      'tasks',
      'about',
      'channel',
      'members',
      'history',
    ]);
  });
});
