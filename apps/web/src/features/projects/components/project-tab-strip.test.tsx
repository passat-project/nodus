// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedView } from '@nodus/contracts';

import { ProjectTabsTrailing, projectViewTabDefs } from './project-tab-strip.js';
import { PROJECT_TAB_DEFS } from './project-tab-strip.js';
import { isProjectViewTabId, projectViewTabId, savedViewIdOfTab } from '../lib/project-tabs.js';

/**
 * #435: вкладки-списки — грамматика CardTabDef и меню «+» (создание
 * «Список…», скрытие/удаление сохранённых вкладок).
 */

const view = (id: string, name: string, entity: SavedView['entity']): SavedView => ({
  id,
  name,
  entity,
  scope: { kind: 'project', projectId: 'p1' },
  level: 'personal',
  filter: [],
  sort: [],
  totals: [],
  columns: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  createdBy: null,
});

afterEach(() => cleanup());

describe('id вкладок-списков (#435)', () => {
  it('view:<id> — и обратно', () => {
    const tabId = projectViewTabId('v-1');
    expect(isProjectViewTabId(tabId)).toBe(true);
    expect(savedViewIdOfTab(tabId)).toBe('v-1');
    expect(isProjectViewTabId('tasks')).toBe(false);
    expect(savedViewIdOfTab('tasks')).toBeNull();
  });

  it('projectViewTabDefs строит CardTabDef той же грамматики', () => {
    const defs = projectViewTabDefs([view('v-1', 'Переработки', 'task')]);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.id).toBe('view:v-1');
    expect(defs[0]!.label).toBe('Переработки');
    expect(defs[0]!.icon).toBeDefined();
    // Системные вкладки не затронуты.
    expect(PROJECT_TAB_DEFS.some((tab) => tab.id === 'view:v-1')).toBe(false);
  });
});

describe('ProjectTabsTrailing: «+» с вкладками-списками (#435)', () => {
  beforeEach(() => {
    // Radix DropdownMenu требует pointer capture — jsdom его не даёт.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.setPointerCapture ??= () => undefined;
    Element.prototype.releasePointerCapture ??= () => undefined;
  });

  it('меню содержит «Новый список» и сохранённые вкладки; удаления в меню нет', () => {
    const onAddList = vi.fn();
    const saved = view('v-1', 'Сметы', 'letter');
    render(
      <ProjectTabsTrailing
        visible={['structure', 'tasks', 'view:v-1']}
        viewTabs={[saved]}
        onToggle={vi.fn()}
        onAddList={onAddList}
      />,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Вкладки' }));
    const add = screen.getByText('Новый список');
    fireEvent.click(add);
    expect(onAddList).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Вкладки' }));
    expect(screen.getByText('Сметы')).not.toBeNull();
    // Удаление списка — кнопкой в его панели, не в меню видимости вкладок.
    expect(screen.queryByLabelText('Удалить вкладку-список')).toBeNull();
  });
});
