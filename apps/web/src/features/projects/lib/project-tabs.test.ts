import { describe, expect, it } from 'vitest';

import { groupsFromDefaultGroups } from '../../../shared/ui/entity-card/card-tabs-prefs.js';
import { PROJECT_DEFAULT_GROUPS, PROJECT_TAB_IDS } from './project-tabs.js';

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

  it('системная раскладка: «О проекте» отдельной областью слева', () => {
    const groups = groupsFromDefaultGroups(PROJECT_DEFAULT_GROUPS, {
      stableTabs: PROJECT_TAB_IDS,
    });
    expect(groups.map((group) => group.tabs)).toEqual([
      ['about'],
      ['structure', 'tasks', 'channel', 'members', 'history'],
    ]);
  });
});
