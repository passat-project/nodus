// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useListExt } from './use-list-ext.js';

/** Состояние расширения списка (#435): цикл сортировки asc → desc → сброс,
 * применение вида, транспорт params и полный сброс. */
describe('useListExt (#435)', () => {
  it('цикл клика по заголовку: asc → desc → нет; чужой маппинг поля игнорируется', () => {
    const { result } = renderHook(() => useListExt());
    const cycle = result.current.cycleColumnSort;
    act(() => cycle('cf.hours', (id) => id));
    expect(result.current.sort).toEqual([{ field: 'cf.hours', dir: 'asc' }]);
    act(() => cycle('cf.hours', (id) => id));
    expect(result.current.sort).toEqual([{ field: 'cf.hours', dir: 'desc' }]);
    expect(result.current.sortOfColumn('cf.hours')).toBe('desc');
    expect(result.current.sortOfColumn('title')).toBeUndefined();
    act(() => cycle('cf.hours', (id) => id));
    expect(result.current.sort).toEqual([]);
    act(() => cycle('cf.gone', () => null));
    expect(result.current.sort).toEqual([]);
  });

  it('applyViewExt применяет сортировку/группировку/итоги вида; params следует за состоянием', () => {
    const { result } = renderHook(() => useListExt());
    act(() =>
      result.current.applyViewExt({
        sort: [{ field: 'createdAt', dir: 'asc' }],
        group: { field: 'stage' },
        totals: [{ fn: 'count' }],
      }),
    );
    expect(result.current.group).toEqual({ field: 'stage' });
    expect(result.current.params).toEqual({
      filter: [],
      sort: [{ field: 'createdAt', dir: 'asc' }],
      group: { field: 'stage' },
      totals: [{ fn: 'count' }],
    });
  });

  it('reset очищает всё состояние расширения', () => {
    const { result } = renderHook(() => useListExt());
    act(() => {
      result.current.setSort([{ field: 'number', dir: 'asc' }]);
      result.current.setGroup({ field: 'assignee' });
      result.current.setTotals([{ fn: 'sum', field: 'number' }]);
    });
    act(() => result.current.reset());
    expect(result.current.sort).toEqual([]);
    expect(result.current.group).toBeUndefined();
    expect(result.current.totals).toEqual([]);
    expect(result.current.params).toEqual({ filter: [], sort: [], group: undefined, totals: [] });
  });
});
