// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useListToolbar } from './use-list-toolbar.js';

describe('useListToolbar: числовой фильтр с границей 0', () => {
  beforeEach(() => localStorage.clear());

  it('«от 0» — активный фильтр, а не пустое значение', () => {
    const { result } = renderHook(() => useListToolbar('test-num-range'));

    act(() => result.current.setFilter('amount', { from: 0 }));

    expect(result.current.filters.amount).toEqual({ from: 0 });
  });

  it('«до 0» тоже сохраняется', () => {
    const { result } = renderHook(() => useListToolbar('test-num-range-to'));

    act(() => result.current.setFilter('amount', { to: 0 }));

    expect(result.current.filters.amount).toEqual({ to: 0 });
  });

  it('пустой диапазон по-прежнему удаляет фильтр', () => {
    const { result } = renderHook(() => useListToolbar('test-num-range-empty'));

    act(() => result.current.setFilter('amount', { from: 1, to: 5 }));
    act(() => result.current.setFilter('amount', { from: undefined, to: undefined }));

    expect(result.current.filters.amount).toBeUndefined();
  });
});
