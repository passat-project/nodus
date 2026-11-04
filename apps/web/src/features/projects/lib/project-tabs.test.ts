import { describe, expect, it } from 'vitest';

import { PROJECT_TAB_IDS, primaryTab, readHiddenTabs, visibleTabs } from './project-tabs.js';

describe('вкладки карточки проекта', () => {
  it('без памяти видны все вкладки в порядке реестра, «Структура» — первой', () => {
    expect(visibleTabs(PROJECT_TAB_IDS, readHiddenTabs(null, 'structure'), 'structure')).toEqual([
      ...PROJECT_TAB_IDS,
    ]);
    expect(PROJECT_TAB_IDS[0]).toBe('structure');
  });

  it('скрытые вкладки читаются из памяти, мусор и неизвестные ключи отбрасываются', () => {
    expect(readHiddenTabs('["history","nope",42]', 'structure')).toEqual(['history']);
    expect(readHiddenTabs('не json', 'structure')).toEqual([]);
    expect(readHiddenTabs('{"history":true}', 'structure')).toEqual([]);
  });

  it('первичная вкладка всегда «Структура»: её нельзя скрыть', () => {
    const primary = primaryTab();
    expect(primary).toBe('structure');
    expect(readHiddenTabs('["structure","channel"]', primary)).toEqual(['channel']);
    const visible = visibleTabs(
      PROJECT_TAB_IDS,
      readHiddenTabs('["structure","channel"]', primary),
      primary,
    );
    expect(visible).not.toContain('channel');
    expect(visible).toContain('structure');
  });

  it('«Задачи» скрываются, «Структура» остаётся', () => {
    const primary = primaryTab();
    expect(readHiddenTabs('["tasks","structure"]', primary)).toEqual(['tasks']);
    const visible = visibleTabs(PROJECT_TAB_IDS, ['tasks'], primary);
    expect(visible).not.toContain('tasks');
    expect(visible).toContain('structure');
  });
});
