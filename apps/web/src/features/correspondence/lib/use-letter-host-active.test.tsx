// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useLetterHostActive } from './use-letter-host-active.js';
import { initialTabs } from './letter-tabs.js';

const GROUPS = [
  { id: 'area-1', tabs: ['body', 'chat'], active: 'body' },
  { id: 'area-2', tabs: ['history'], active: 'history' },
];

describe('useLetterHostActive: активная вкладка хоста следует за движком', () => {
  it('фокусная область задаёт активную вкладку', () => {
    const setTabsState = vi.fn();
    renderHook(() => useLetterHostActive(GROUPS, 'area-2', 'body', setTabsState));
    expect(setTabsState).toHaveBeenCalledTimes(1);
    const updater = setTabsState.mock.calls[0]?.[0] as (current: unknown) => { active: string };
    expect(updater(initialTabs('body'))).toMatchObject({ active: 'history' });
  });

  it('без фокусной области берётся первая; при null host-состоянии создаётся initial', () => {
    const setTabsState = vi.fn();
    renderHook(() => useLetterHostActive(GROUPS, null, undefined, setTabsState));
    const updater = setTabsState.mock.calls[0]?.[0] as (current: unknown) => { active: string };
    expect(updater(null)).toMatchObject({ active: 'body' });
  });

  it('совпадающая активная и пустые группы не трогают хост', () => {
    const setTabsState = vi.fn();
    renderHook(() => useLetterHostActive(GROUPS, 'area-1', 'body', setTabsState));
    expect(setTabsState).not.toHaveBeenCalled();

    renderHook(() => useLetterHostActive([], null, 'body', setTabsState));
    expect(setTabsState).not.toHaveBeenCalled();
  });
});
