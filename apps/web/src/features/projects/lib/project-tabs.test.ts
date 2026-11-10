import { describe, expect, it } from 'vitest';

import { PROJECT_TAB_IDS, readHiddenTabs, visibleTabs } from './project-tabs.js';

describe('вкладки карточки проекта', () => {
  it('системный порядок: «О проекте» после «Задач», «Структура» первой', () => {
    expect(PROJECT_TAB_IDS).toEqual([
      'structure',
      'tasks',
      'about',
      'channel',
      'members',
      'history',
    ]);
    expect(visibleTabs(PROJECT_TAB_IDS, readHiddenTabs(null))).toEqual([...PROJECT_TAB_IDS]);
  });

  it('скрытые вкладки читаются из памяти, мусор и неизвестные ключи отбрасываются', () => {
    expect(readHiddenTabs('["history","nope",42]')).toEqual(['history']);
    expect(readHiddenTabs('не json')).toEqual([]);
    expect(readHiddenTabs('{"history":true}')).toEqual([]);
  });

  it('«Структура» скрывается как обычная вкладка, пока есть другие', () => {
    expect(readHiddenTabs('["structure","channel"]')).toEqual(['structure', 'channel']);
    const visible = visibleTabs(PROJECT_TAB_IDS, readHiddenTabs('["structure","channel"]'));
    expect(visible).not.toContain('channel');
    expect(visible).not.toContain('structure');
    expect(visible[0]).toBe('tasks');
  });

  it('«О проекте» и «Задачи» скрываются как обычные вкладки', () => {
    const hidden = readHiddenTabs('["tasks","about"]');
    expect(hidden).toEqual(['tasks', 'about']);
    const visible = visibleTabs(PROJECT_TAB_IDS, hidden);
    expect(visible).not.toContain('tasks');
    expect(visible).not.toContain('about');
  });

  it('все вкладки скрыть нельзя — минимум одна остаётся', () => {
    expect(readHiddenTabs(JSON.stringify([...PROJECT_TAB_IDS]))).toHaveLength(
      PROJECT_TAB_IDS.length - 1,
    );
  });
});
