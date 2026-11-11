import { describe, expect, it } from 'vitest';

import {
  activateTab,
  closeTab,
  createCardTabsState,
  mergeGroups,
  moveTab,
  nextGroupId,
  normalizeGroups,
  reorderTab,
  resolveDrop,
  splitTab,
  type CardTabGroup,
} from './card-tabs-model.js';

const A = (tabs: string[], active = tabs[0]!, id = 'area-1'): CardTabGroup => ({
  id,
  tabs,
  active,
});

const KNOWN = ['structure', 'tasks', 'about', 'channel', 'members', 'history', 'files'];

describe('normalizeGroups', () => {
  it('дедуп, неизвестные выброшены, группы непустые', () => {
    const groups = normalizeGroups(
      [A(['structure', 'unknown', 'tasks']), A(['structure', 'about'], 'about', 'area-2')],
      KNOWN,
    );
    expect(groups.map((g) => g.tabs)).toEqual([['structure', 'tasks'], ['about']]);
  });

  it('пустой вход — fallback-группа с первой известной вкладкой', () => {
    expect(normalizeGroups([], KNOWN, 2, 'channel')).toEqual([
      { id: 'area-1', tabs: ['channel'], active: 'channel' },
    ]);
  });

  it('больше max групп — сливаются в последнюю разрешённую', () => {
    const groups = normalizeGroups(
      [A(['structure']), A(['tasks'], 'tasks', 'area-2'), A(['channel'], 'channel', 'area-3')],
      KNOWN,
      2,
    );
    expect(groups).toHaveLength(2);
    expect(groups[1]?.tabs).toEqual(['tasks', 'channel']);
  });

  it('невалидная активная — первая вкладка группы', () => {
    expect(normalizeGroups([A(['tasks'], 'nope')], KNOWN)[0]?.active).toBe('tasks');
  });
});

describe('createCardTabsState', () => {
  it('дефолт — активная первой группы, все вкладки посещены', () => {
    const state = createCardTabsState([A(['structure', 'tasks'])]);
    expect(state.groups[0]?.active).toBe('structure');
    expect(state.visited).toEqual({ structure: true, tasks: true });
    expect(state.focusGroupId).toBe('area-1');
  });

  it('activeTab вне групп добавляется в первую', () => {
    const state = createCardTabsState([A(['structure'])], { activeTab: 'chat' });
    expect(state.groups[0]?.tabs).toEqual(['chat', 'structure']);
    expect(state.groups[0]?.active).toBe('chat');
  });
});

describe('reorderTab', () => {
  it('движение вправо учитывает удаление элемента', () => {
    const result = reorderTab([A(['a', 'b', 'c'])], 'area-1', 'a', 3);
    expect(result[0]?.tabs).toEqual(['b', 'c', 'a']);
  });

  it('перестановка на своё место — no-op', () => {
    const groups = [A(['a', 'b', 'c'])];
    expect(reorderTab(groups, 'area-1', 'b', 1)[0]?.tabs).toEqual(['a', 'b', 'c']);
    expect(reorderTab(groups, 'area-1', 'b', 2)[0]?.tabs).toEqual(['a', 'b', 'c']);
  });

  it('не мутирует вход', () => {
    const groups = [A(['a', 'b'])];
    reorderTab(groups, 'area-1', 'a', 2);
    expect(groups[0]?.tabs).toEqual(['a', 'b']);
  });
});

describe('moveTab', () => {
  it('перенос в другую область активирует вкладку там', () => {
    const groups = [A(['a', 'b']), A(['c'], 'c', 'area-2')];
    const result = moveTab(groups, 'area-2', 'a', 1);
    expect(result[0]?.tabs).toEqual(['b']);
    expect(result[1]?.tabs).toEqual(['c', 'a']);
    expect(result[1]?.active).toBe('a');
  });

  it('исходная пустая область закрывается', () => {
    const groups = [A(['a']), A(['b'], 'b', 'area-2')];
    const result = moveTab(groups, 'area-2', 'a');
    expect(result).toHaveLength(1);
    expect(result[0]?.tabs).toEqual(['b', 'a']);
  });

  it('перенос в свою область с end — перестановка, не дубль', () => {
    const result = moveTab([A(['a', 'b'])], 'area-1', 'a', 'end');
    expect(result[0]?.tabs).toEqual(['b', 'a']);
  });
});

describe('splitTab', () => {
  it('вкладка уезжает в новую область справа, исходная активирует соседа', () => {
    const result = splitTab([A(['a', 'b'], 'b')], 'area-1', 'b', 'right');
    expect(result.map((g) => g.tabs)).toEqual([['a'], ['b']]);
    expect(result[0]?.active).toBe('a');
    expect(result[1]?.active).toBe('b');
  });

  it('одиночная вкладка — исходная закрывается, остаётся одна область', () => {
    const result = splitTab([A(['a'])], 'area-1', 'a', 'right');
    expect(result).toHaveLength(1);
    expect(result[0]?.tabs).toEqual(['a']);
  });

  it('третья область не создаётся', () => {
    const groups = [A(['a']), A(['b'], 'b', 'area-2')];
    expect(splitTab(groups, 'area-1', 'a')).toEqual(groups);
  });

  it('split влево ставит новую область перед исходной', () => {
    const result = splitTab([A(['a', 'b'])], 'area-1', 'b', 'left');
    expect(result.map((g) => g.tabs)).toEqual([['b'], ['a']]);
    expect(result[0]?.id).toBe('area-2');
  });
});

describe('mergeGroups', () => {
  it('собирает всё влево; активная — из focus-группы', () => {
    const result = mergeGroups([A(['a', 'b']), A(['c', 'd'], 'd', 'area-2')], 'area-2');
    expect(result).toHaveLength(1);
    expect(result[0]?.tabs).toEqual(['a', 'b', 'c', 'd']);
    expect(result[0]?.active).toBe('d');
  });

  it('без focus — активная левой', () => {
    expect(mergeGroups([A(['a'], 'a'), A(['b'], 'b', 'area-2')])[0]?.active).toBe('a');
  });
});

describe('closeTab', () => {
  it('активная уходит к соседу слева', () => {
    const result = closeTab([A(['a', 'b', 'c'], 'b')], 'area-1', 'b');
    expect(result[0]?.tabs).toEqual(['a', 'c']);
    expect(result[0]?.active).toBe('a');
  });

  it('пустая вторая область удаляется', () => {
    const result = closeTab([A(['a']), A(['b'], 'b', 'area-2')], 'area-2', 'b');
    expect(result).toHaveLength(1);
  });

  it('последнюю вкладку последней области закрыть нельзя', () => {
    const groups = [A(['a'])];
    expect(closeTab(groups, 'area-1', 'a')).toEqual(groups);
  });
});

describe('activateTab / nextGroupId', () => {
  it('активация посещает вкладку', () => {
    const state = createCardTabsState([A(['a', 'b'])], { visited: ['a'] });
    const next = activateTab(state, 'area-1', 'b');
    expect(next.groups[0]?.active).toBe('b');
    expect(next.visited.b).toBe(true);
  });

  it('id не пересекается с занятыми', () => {
    expect(nextGroupId([A(['a'], 'a', 'area-2')])).toBe('area-1');
    expect(nextGroupId([A(['a'], 'a', 'area-1'), A(['b'], 'b', 'area-2')])).toBe('area-3');
  });
});

describe('resolveDrop', () => {
  const workArea = { left: 0, right: 1000, top: 0, bottom: 600 };
  const areas = [
    {
      groupId: 'area-1',
      strip: { left: 0, right: 500, top: 0, bottom: 40 },
      content: { left: 0, right: 500, top: 40, bottom: 600 },
      tabs: [
        { tabId: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
        { tabId: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
      ],
    },
    {
      groupId: 'area-2',
      strip: { left: 500, right: 1000, top: 0, bottom: 40 },
      content: { left: 500, right: 1000, top: 40, bottom: 600 },
      tabs: [{ tabId: 'c', rect: { left: 500, right: 600, top: 0, bottom: 40 } }],
    },
  ];
  const groups = [A(['a', 'b']), A(['c'], 'c', 'area-2')];

  it('своё место — noop', () => {
    expect(
      resolveDrop({
        groups,
        source: { groupId: 'area-1', tabId: 'a' },
        pointer: { x: 10, y: 20 },
        areas,
        workArea,
      }).type,
    ).toBe('noop');
  });

  it('перестановка внутри полосы', () => {
    expect(
      resolveDrop({
        groups,
        source: { groupId: 'area-1', tabId: 'a' },
        pointer: { x: 150, y: 20 },
        areas,
        workArea,
      }),
    ).toMatchObject({ type: 'reorder', groupId: 'area-1', index: 2 });
  });

  it('перенос на чужую полосу — вставка по индексу', () => {
    expect(
      resolveDrop({
        groups,
        source: { groupId: 'area-1', tabId: 'a' },
        pointer: { x: 550, y: 20 },
        areas,
        workArea,
      }),
    ).toMatchObject({ type: 'move', targetGroupId: 'area-2', index: 1 });
  });

  it('контент чужой области — в конец и активировать', () => {
    expect(
      resolveDrop({
        groups,
        source: { groupId: 'area-1', tabId: 'a' },
        pointer: { x: 800, y: 300 },
        areas,
        workArea,
      }),
    ).toMatchObject({ type: 'move-end', targetGroupId: 'area-2' });
  });

  it('свой контент — только активация', () => {
    expect(
      resolveDrop({
        groups,
        source: { groupId: 'area-1', tabId: 'a' },
        pointer: { x: 300, y: 300 },
        areas,
        workArea,
      }),
    ).toMatchObject({ type: 'activate', groupId: 'area-1' });
  });

  it('край рабочей зоны — новая область (когда групп < 2)', () => {
    expect(
      resolveDrop({
        groups: [A(['a', 'b'])],
        source: { groupId: 'area-1', tabId: 'a' },
        pointer: { x: 950, y: 300 },
        areas: [areas[0]!],
        workArea,
      }),
    ).toMatchObject({ type: 'split', side: 'right' });
  });

  it('при двух областях край не создаёт третью', () => {
    expect(
      resolveDrop({
        groups,
        source: { groupId: 'area-1', tabId: 'a' },
        pointer: { x: 950, y: 300 },
        areas,
        workArea,
      }),
    ).toMatchObject({ type: 'move-end', targetGroupId: 'area-2' });
  });
});
