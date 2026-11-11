// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { rectOf, useCardTabGeometry } from './use-card-tab-geometry.js';

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect;
}

function stripElement(tabs: string[]): HTMLDivElement {
  const strip = document.createElement('div');
  strip.getBoundingClientRect = () => rect(0, 0, 800, 40);
  for (const [index, tabId] of tabs.entries()) {
    const tab = document.createElement('div');
    tab.dataset.cardTabId = tabId;
    tab.getBoundingClientRect = () => rect(index * 100, 0, index * 100 + 100, 40);
    strip.append(tab);
  }
  return strip;
}

describe('useCardTabGeometry: замер областей для DnD', () => {
  it('без корня отдаёт пустые области и нулевую рабочую зону', () => {
    const rootRef = { current: null as HTMLDivElement | null };
    const stripEls = { current: new Map<string, HTMLDivElement>() };
    const { result } = renderHook(() => useCardTabGeometry({ rootRef, groups: [], stripEls }));
    expect(result.current()).toEqual({
      areas: [],
      workArea: { left: 0, top: 0, right: 0, bottom: 0 },
      strips: [],
    });
  });

  it('собирает полосу, контент и вкладки; отсутствующая полоса пропускается', () => {
    const root = document.createElement('div');
    root.getBoundingClientRect = () => rect(0, 0, 800, 600);
    const rootRef = { current: root as HTMLDivElement | null };
    const strip = stripElement(['a', 'b']);
    const stripEls = { current: new Map([['area-1', strip]]) };
    const groups = [
      { id: 'area-1', tabs: ['a', 'b'], active: 'a' },
      { id: 'area-2', tabs: [], active: '' },
    ];

    const { result } = renderHook(() => useCardTabGeometry({ rootRef, groups, stripEls }));
    const geometry = result.current();

    expect(geometry.workArea).toEqual({ left: 0, top: 0, right: 800, bottom: 600 });
    expect(geometry.strips).toHaveLength(1);
    expect(geometry.strips[0]?.el).toBe(strip);
    expect(geometry.areas).toHaveLength(1);
    expect(geometry.areas[0]).toEqual({
      groupId: 'area-1',
      strip: { left: 0, top: 0, right: 800, bottom: 40 },
      content: { left: 0, top: 40, right: 800, bottom: 600 },
      tabs: [
        { tabId: 'a', rect: { left: 0, top: 0, right: 100, bottom: 40 } },
        { tabId: 'b', rect: { left: 100, top: 0, right: 200, bottom: 40 } },
      ],
    });
  });

  it('rectOf отдаёт только координаты без размеров', () => {
    const element = document.createElement('div');
    element.getBoundingClientRect = () => rect(10, 20, 30, 50);
    expect(rectOf(element)).toEqual({ left: 10, top: 20, right: 30, bottom: 50 });
  });
});
