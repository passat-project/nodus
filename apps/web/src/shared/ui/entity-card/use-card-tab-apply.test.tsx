// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCardTabsState, type CardTabsState, type DropResolution } from './card-tabs-model.js';
import type { CardTabDef } from './card-tab-strip.js';
import { useCardTabApply } from './use-card-tab-apply.js';

const toastMock = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));

const TABS: CardTabDef[] = [
  { id: 'a', label: 'Альфа', icon: null },
  { id: 'b', label: 'Бета', icon: null },
  { id: 'c', label: 'Гамма', icon: null },
  { id: 'd', label: 'Дельта', icon: null },
];
const TAB_BY_ID = new Map(TABS.map((tab) => [tab.id, tab]));

const ONE: CardTabsState = createCardTabsState([
  { id: 'area-1', tabs: ['a', 'b', 'c'], active: 'a' },
]);
const TWO: CardTabsState = createCardTabsState([
  { id: 'area-1', tabs: ['a', 'b', 'c'], active: 'a' },
  { id: 'area-2', tabs: ['d'], active: 'd' },
]);

let apply: ((resolution: DropResolution) => void) | null = null;

function Harness({
  state,
  onApply,
  onAnnounce,
  onFocusTab,
}: {
  state: CardTabsState;
  onApply: (next: CardTabsState) => void;
  onAnnounce: (text: string) => void;
  onFocusTab: (tabId: string) => void;
}) {
  apply = useCardTabApply({ state, tabById: TAB_BY_ID, onApply, onAnnounce, onFocusTab });
  return null;
}

function setup(state: CardTabsState) {
  const onApply = vi.fn();
  const onAnnounce = vi.fn();
  const onFocusTab = vi.fn();
  render(
    <Harness state={state} onApply={onApply} onAnnounce={onAnnounce} onFocusTab={onFocusTab} />,
  );
  return { onApply, onAnnounce, onFocusTab };
}

afterEach(() => {
  vi.clearAllMocks();
  apply = null;
});

describe('useCardTabApply: решения drop → модель и объявления', () => {
  it('noop ничего не меняет', () => {
    const { onApply, onAnnounce, onFocusTab } = setup(ONE);
    act(() => apply?.({ type: 'noop' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onAnnounce).not.toHaveBeenCalled();
    expect(onFocusTab).not.toHaveBeenCalled();
  });

  it('activate переключает вкладку без объявления', () => {
    const { onApply, onAnnounce } = setup(ONE);
    act(() => apply?.({ type: 'activate', groupId: 'area-1', tabId: 'c' }));
    expect(onApply.mock.calls[0]?.[0].groups[0].active).toBe('c');
    expect(onAnnounce).not.toHaveBeenCalled();
  });

  it('reorder двигает вкладку, объявляет позицию и возвращает фокус', () => {
    const { onApply, onAnnounce, onFocusTab } = setup(ONE);
    act(() => apply?.({ type: 'reorder', groupId: 'area-1', tabId: 'a', index: 3 }));
    expect(onApply.mock.calls[0]?.[0].groups[0].tabs).toEqual(['b', 'c', 'a']);
    expect(onAnnounce).toHaveBeenCalledWith('Вкладка «Альфа» перемещена: позиция 4');
    expect(onFocusTab).toHaveBeenCalledWith('a');
    // Нет подписи — в объявлении id.
    act(() => apply?.({ type: 'reorder', groupId: 'area-1', tabId: 'x', index: 0 }));
    expect(onAnnounce).toHaveBeenLastCalledWith('Вкладка «x» перемещена: позиция 1');
  });

  it('move в другую область активирует вкладку и объявляет номер области', () => {
    const { onApply, onAnnounce, onFocusTab } = setup(TWO);
    act(() => apply?.({ type: 'move', targetGroupId: 'area-2', tabId: 'a', index: 0 }));
    const next = onApply.mock.calls[0]?.[0] as CardTabsState;
    expect(next.groups.map((group) => group.tabs)).toEqual([
      ['b', 'c'],
      ['a', 'd'],
    ]);
    expect(next.groups[1]?.active).toBe('a');
    expect(next.focusGroupId).toBe('area-2');
    expect(onAnnounce).toHaveBeenCalledWith('Вкладка «Альфа» перемещена в область 2');
    expect(onFocusTab).toHaveBeenCalledWith('a');
  });

  it('move-end переносит в конец области', () => {
    const { onApply } = setup(TWO);
    act(() => apply?.({ type: 'move-end', targetGroupId: 'area-2', tabId: 'b' }));
    const next = onApply.mock.calls[0]?.[0] as CardTabsState;
    expect(next.groups.map((group) => group.tabs)).toEqual([
      ['a', 'c'],
      ['d', 'b'],
    ]);
    expect(next.groups[1]?.active).toBe('b');
  });

  it('split создаёт вторую область и фокусирует перенесённую вкладку', () => {
    const { onApply, onAnnounce, onFocusTab } = setup(ONE);
    act(() => apply?.({ type: 'split', groupId: 'area-1', tabId: 'b', side: 'right' }));
    const next = onApply.mock.calls[0]?.[0] as CardTabsState;
    expect(next.groups).toHaveLength(2);
    expect(next.groups[1]?.tabs).toEqual(['b']);
    expect(next.groups[1]?.active).toBe('b');
    expect(next.focusGroupId).toBe(next.groups[1]?.id);
    expect(onAnnounce).toHaveBeenCalledWith('Создана вторая область вкладок');
    expect(onFocusTab).toHaveBeenCalledWith('b');
  });

  it('split при двух областях показывает toast и не меняет состояние', () => {
    const { onApply, onFocusTab } = setup(TWO);
    act(() => apply?.({ type: 'split', groupId: 'area-1', tabId: 'a', side: 'left' }));
    expect(toastMock).toHaveBeenCalledWith('Пока максимум две области');
    expect(onApply).not.toHaveBeenCalled();
    expect(onFocusTab).not.toHaveBeenCalled();
  });
});
