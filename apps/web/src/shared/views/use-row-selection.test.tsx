// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useRowSelection } from './use-row-selection.js';

describe('useRowSelection: «выбрать все» при скрытых выбранных строках', () => {
  it('снимает выбор видимых, даже если набор больше видимого списка', () => {
    const { result, rerender } = renderHook(({ keys }) => useRowSelection(keys), {
      initialProps: { keys: ['a', 'b', 'c'] },
    });
    act(() => result.current.toggleAll());
    expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c']);

    // Фильтр/схлопывание ветки сузили список: «c» выбрана, но не видна.
    rerender({ keys: ['a', 'b'] });
    expect(result.current.headerChecked).toBe(true);

    act(() => result.current.toggleAll());
    expect([...result.current.selected]).toEqual(['c']);
    expect(result.current.headerChecked).toBe(false);
  });

  it('добавляет видимые к уже выбранным скрытым', () => {
    const { result, rerender } = renderHook(({ keys }) => useRowSelection(keys), {
      initialProps: { keys: ['c'] },
    });
    act(() => result.current.toggle('c'));
    rerender({ keys: ['a', 'b'] });

    act(() => result.current.toggleAll());
    expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c']);
  });
});
