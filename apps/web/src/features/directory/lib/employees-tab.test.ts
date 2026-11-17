import { describe, expect, it } from 'vitest';

import {
  canonicalEmployeesView,
  employeesTabSearch,
  resolveEmployeesTab,
} from './employees-tab.js';

describe('вкладки «Сотрудники» (#768)', () => {
  it('«Список» — дефолт, «Структура» — ?view=structure', () => {
    expect(resolveEmployeesTab(undefined)).toBe('list');
    expect(resolveEmployeesTab('list')).toBe('list');
    expect(resolveEmployeesTab('structure')).toBe('structure');
    expect(employeesTabSearch('list')).toEqual({});
    expect(employeesTabSearch('structure')).toEqual({ view: 'structure' });
  });

  it('старые адреса: divisions/subordination → structure, settings/неизвестный → список', () => {
    expect(resolveEmployeesTab('divisions')).toBe('structure');
    expect(resolveEmployeesTab('subordination')).toBe('structure');
    expect(resolveEmployeesTab('settings')).toBe('list');
    expect(resolveEmployeesTab('what-is-it')).toBe('list');

    expect(canonicalEmployeesView(undefined)).toBeNull();
    expect(canonicalEmployeesView('list')).toBeNull();
    expect(canonicalEmployeesView('structure')).toBeNull();
    expect(canonicalEmployeesView('divisions')).toBe('structure');
    expect(canonicalEmployeesView('subordination')).toBe('structure');
    expect(canonicalEmployeesView('settings')).toBeUndefined();
    expect(canonicalEmployeesView('unknown')).toBeUndefined();
  });
});
