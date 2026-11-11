// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createCardTabsState, type CardTabsState } from './card-tabs-model.js';
import { useCardTabKeyboard } from './use-card-tab-keyboard.js';

const STATE: CardTabsState = createCardTabsState([
  { id: 'area-1', tabs: ['a', 'b', 'c'], active: 'a' },
  { id: 'area-2', tabs: ['d'], active: 'd' },
]);

function stripWithTabs() {
  const strip = document.createElement('div');
  for (const tabId of ['a', 'b', 'c']) {
    const tab = document.createElement('div');
    tab.dataset.cardTabId = tabId;
    tab.getBoundingClientRect = () => ({ left: tabId === 'a' ? 0 : 100, bottom: 40 }) as DOMRect;
    strip.append(tab);
  }
  return strip;
}

function setup(state: CardTabsState = STATE, groupId = 'area-1') {
  const onApply = vi.fn();
  const onFocusTab = vi.fn();
  const onOpenMenu = vi.fn();
  const { result } = renderHook(() =>
    useCardTabKeyboard({ state, onApply, onFocusTab, onOpenMenu }),
  );
  const handler = result.current(groupId);
  const strip = stripWithTabs();
  const fire = (key: string, init: { shiftKey?: boolean; target?: HTMLElement } = {}) => {
    const preventDefault = vi.fn();
    handler({
      key,
      shiftKey: init.shiftKey ?? false,
      target: init.target ?? strip,
      currentTarget: strip,
      preventDefault,
    } as unknown as ReactKeyboardEvent<HTMLDivElement>);
    return { preventDefault };
  };
  return { onApply, onFocusTab, onOpenMenu, fire, strip };
}

describe('useCardTabKeyboard: стрелки, Home/End и контекстное меню', () => {
  it('→ и ← переключают соседнюю вкладку по кругу и ведут фокус', () => {
    const { onApply, onFocusTab, fire } = setup();
    const right = fire('ArrowRight');
    expect(right.preventDefault).toHaveBeenCalled();
    expect(onApply.mock.calls[0]?.[0].groups[0].active).toBe('b');
    expect(onFocusTab).toHaveBeenLastCalledWith('b');

    const left = fire('ArrowLeft');
    expect(left.preventDefault).toHaveBeenCalled();
    expect(onApply.mock.calls[1]?.[0].groups[0].active).toBe('c');
    expect(onFocusTab).toHaveBeenLastCalledWith('c');
  });

  it('Home/End прыгают к краям полосы', () => {
    const { onApply, onFocusTab, fire } = setup();
    fire('End');
    expect(onApply.mock.calls[0]?.[0].groups[0].active).toBe('c');
    expect(onFocusTab).toHaveBeenLastCalledWith('c');
    fire('Home');
    expect(onApply.mock.calls[1]?.[0].groups[0].active).toBe('a');
    expect(onFocusTab).toHaveBeenLastCalledWith('a');
  });

  it('одиночная вкладка не требует переключения', () => {
    const { onApply, fire } = setup(STATE, 'area-2');
    const { preventDefault } = fire('ArrowRight');
    expect(onApply).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    // Home/End на одиночной вкладке остаются в ней.
    fire('End');
    expect(onApply.mock.calls[0]?.[0].groups[1].active).toBe('d');
  });

  it('поля ввода и неизвестная область не перехватываются', () => {
    const { onApply, fire } = setup();
    const input = document.createElement('input');
    fire('ArrowRight', { target: input });
    expect(onApply).not.toHaveBeenCalled();

    const unknown = setup(STATE, 'area-x');
    unknown.fire('ArrowRight');
    expect(unknown.onApply).not.toHaveBeenCalled();
  });

  it('Shift+F10 и ContextMenu открывают меню у активной вкладки', () => {
    const { onOpenMenu, fire } = setup();
    const first = fire('ContextMenu');
    expect(first.preventDefault).toHaveBeenCalled();
    expect(onOpenMenu).toHaveBeenCalledWith('area-1', 'a', 0, 40);

    const second = fire('F10', { shiftKey: true });
    expect(second.preventDefault).toHaveBeenCalled();
    expect(onOpenMenu).toHaveBeenCalledTimes(2);
  });
});
