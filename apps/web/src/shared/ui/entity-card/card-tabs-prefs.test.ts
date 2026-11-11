// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  FILE_TAB_PLACEHOLDER,
  firstVisibleTab,
  groupsFromPref,
  hiddenFromPref,
  prefFromState,
  toPrefTab,
  toggleHiddenTab,
} from './card-tabs-prefs.js';
import type { CardTabsState } from './card-tabs-model.js';

const STABLE = ['structure', 'tasks', 'about', 'channel', 'members', 'history'];

describe('groupsFromPref', () => {
  it('без prefs — системный порядок одной областью', () => {
    const groups = groupsFromPref(undefined, { stableTabs: STABLE });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tabs).toEqual(STABLE);
    expect(groups[0]?.active).toBe('structure');
  });

  it('сохраняет две области, порядок и активные', () => {
    const groups = groupsFromPref(
      {
        version: 1,
        groups: [
          { tabs: ['channel', 'structure'], active: 'channel' },
          { tabs: ['tasks', 'about'], active: 'about' },
        ],
      },
      { stableTabs: STABLE },
    );
    expect(groups.map((g) => g.tabs)).toEqual([
      ['channel', 'structure', 'members', 'history'],
      ['tasks', 'about'],
    ]);
    expect(groups[0]?.active).toBe('channel');
    expect(groups[1]?.active).toBe('about');
  });

  it('files разворачивается в реальные файловые вкладки', () => {
    const groups = groupsFromPref(
      {
        version: 1,
        groups: [{ tabs: ['chat', FILE_TAB_PLACEHOLDER], active: FILE_TAB_PLACEHOLDER }],
      },
      { stableTabs: ['chat'], fileTabs: ['file:a', 'file:b'] },
    );
    expect(groups[0]?.tabs).toEqual(['chat', 'file:a', 'file:b']);
    expect(groups[0]?.active).toBe('file:a');
  });

  it('файлы из второй области не дублируются: плейсхолдер живёт в первой', () => {
    const groups = groupsFromPref(
      {
        version: 1,
        groups: [
          { tabs: [FILE_TAB_PLACEHOLDER, 'chat'] },
          { tabs: [FILE_TAB_PLACEHOLDER, 'history'] },
        ],
      },
      { stableTabs: ['chat', 'history'], fileTabs: ['file:a'] },
    );
    // Вторая группа после удаления files остаётся с history.
    expect(groups.map((g) => g.tabs)).toEqual([['file:a', 'chat'], ['history']]);
  });

  it('новые системные вкладки дописываются в первую область и видимы', () => {
    const groups = groupsFromPref(
      { version: 1, groups: [{ tabs: ['structure'] }] },
      { stableTabs: ['structure', 'tasks', 'about'] },
    );
    expect(groups[0]?.tabs).toEqual(['structure', 'tasks', 'about']);
  });

  it('скрытые вкладки не показываются; files скрыть нельзя', () => {
    const groups = groupsFromPref(
      { version: 1, groups: [{ tabs: ['structure', 'tasks'] }], hidden: ['tasks', 'files'] },
      { stableTabs: ['structure', 'tasks'], hidden: ['tasks'] },
    );
    expect(groups[0]?.tabs).toEqual(['structure']);
  });

  it('неизвестные id отбрасываются', () => {
    const groups = groupsFromPref(
      { version: 1, groups: [{ tabs: ['unknown', 'structure'] }] },
      { stableTabs: ['structure'] },
    );
    expect(groups[0]?.tabs).toEqual(['structure']);
  });

  it('скрытая сохранённая активная — первая видимая', () => {
    const groups = groupsFromPref(
      { version: 1, groups: [{ tabs: ['tasks'], active: 'tasks' }], hidden: ['tasks'] },
      { stableTabs: ['structure', 'tasks'], hidden: ['tasks'] },
    );
    expect(groups[0]?.tabs).toEqual(['structure']);
    expect(groups[0]?.active).toBe('structure');
  });
});

describe('prefFromState', () => {
  const state: Pick<CardTabsState, 'groups'> = {
    groups: [
      { id: 'area-1', tabs: ['structure', 'file:a'], active: 'file:a' },
      { id: 'area-2', tabs: ['chat', 'history'], active: 'chat' },
    ],
  };

  it('файловые id схлопываются в один files, без uuid', () => {
    const pref = prefFromState(state, { hidden: ['members'], panelOpen: true });
    expect(pref?.groups[0]?.tabs).toEqual(['structure', 'files']);
    expect(pref?.groups[0]?.active).toBe('files');
    expect(JSON.stringify(pref)).not.toContain('file:a');
    expect(pref?.panelOpen).toBe(true);
  });

  it('файлы во второй области: плейсхолдер в первой области С ФАЙЛАМИ', () => {
    const pref = prefFromState({
      groups: [
        { id: 'a1', tabs: ['chat'], active: 'chat' },
        { id: 'a2', tabs: ['file:a', 'history'], active: 'file:a' },
      ],
    });
    expect(pref?.groups.map((g) => g.tabs)).toEqual([['chat'], ['files', 'history']]);
  });

  it('ширины двух областей не переживают исчезновение второй (не падаем)', () => {
    const pref = prefFromState(
      { groups: [{ id: 'a1', tabs: ['chat'], active: 'chat' }] },
      { widths: { data: 340, groups: [400, 400] } },
    );
    expect(pref?.widths?.data).toBe(340);
    expect(pref?.widths?.groups).toBeUndefined();
  });

  it('пустое состояние — null (не пишем пустую карточку)', () => {
    expect(prefFromState({ groups: [] })).toBeNull();
  });

  it('круг pref → groups сохраняет раскладку', () => {
    const pref = prefFromState(state)!;
    const groups = groupsFromPref(pref, {
      stableTabs: ['structure', 'chat', 'history'],
      fileTabs: ['file:a'],
    });
    expect(groups.map((g) => g.tabs)).toEqual([
      ['structure', 'file:a'],
      ['chat', 'history'],
    ]);
  });
});

describe('hidden / helpers', () => {
  it('последнюю видимую скрыть нельзя', () => {
    expect(toggleHiddenTab([], 'structure', ['structure'])).toEqual([]);
    expect(toggleHiddenTab(['tasks'], 'structure', ['structure', 'tasks'])).toEqual(['tasks']);
  });

  it('toggle скрывает и возвращает', () => {
    expect(toggleHiddenTab([], 'tasks', STABLE)).toEqual(['tasks']);
    expect(toggleHiddenTab(['tasks'], 'tasks', STABLE)).toEqual([]);
  });

  it('hiddenFromPref фильтрует неизвестные и files', () => {
    expect(
      hiddenFromPref({ version: 1, groups: [{ tabs: ['a'] }], hidden: ['tasks', 'files'] }, STABLE),
    ).toEqual(['tasks']);
  });

  it('toPrefTab и firstVisibleTab', () => {
    expect(toPrefTab('file:1')).toBe('files');
    expect(toPrefTab('chat')).toBe('chat');
    expect(firstVisibleTab(STABLE, ['structure'])).toBe('tasks');
  });
});
