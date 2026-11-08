import { describe, expect, it } from 'vitest';

import { NAV_MODULES } from './nav-registry.js';

/**
 * Вкладка «Права доступа» (#379, ADR-0034): у раздела с правами в каталоге
 * она есть и стоит последней; у раздела без прав — нет по построению.
 */

describe('реестр навигации: вкладка «Права доступа» (#379)', () => {
  it('у «Автоматизации» вкладка access последняя', () => {
    const automation = NAV_MODULES.find((module) => module.id === 'automation')!;
    expect(automation.tabs.map((tab) => tab.id)).toEqual([
      'processes',
      'fields',
      'project-schemas',
      'registries',
      'access',
    ]);
    const access = automation.tabs.at(-1)!;
    expect(access.search).toEqual({ tab: 'access' });
    expect(access.isActive(new URLSearchParams('tab=access'), [])).toBe(true);
    expect(access.isActive(new URLSearchParams('tab=fields'), [])).toBe(false);
  });

  it('«Процессы» неактивны при tab=access, по умолчанию — активны', () => {
    const automation = NAV_MODULES.find((module) => module.id === 'automation')!;
    const processes = automation.tabs.find((tab) => tab.id === 'processes')!;
    expect(processes.isActive(new URLSearchParams('tab=access'), [])).toBe(false);
    expect(processes.isActive(new URLSearchParams(''), [])).toBe(true);
  });

  it('у модуля без прав в каталоге вкладки access нет', () => {
    const home = NAV_MODULES.find((module) => module.id === 'home')!;
    expect(home.tabs).toEqual([]);
    const tasks = NAV_MODULES.find((module) => module.id === 'tasks')!;
    // Права «Задач» в каталоге есть — вкладку модуль получит отдельной
    // строкой `...accessTab('tasks')`, пока её нет (скоуп #379: «Автоматизация»).
    expect(tasks.tabs.map((tab) => tab.id)).not.toContain('access');
  });
});
