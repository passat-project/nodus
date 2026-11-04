import { describe, expect, it } from 'vitest';
import type { ViewerTarget } from '../../../shared/files/viewer-store.js';
import {
  MAX_FILE_TABS,
  activateTaskTab,
  closeTaskFileTab,
  fileIdOf,
  fileTabId,
  initialTaskTabs,
  openTaskFileTab,
} from './task-tabs.js';

const file = (id: string): ViewerTarget => ({
  fileId: id,
  name: `${id}.docx`,
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 1024,
  url: `/files/${id}`,
});

describe('вкладки карточки задачи', () => {
  it('стартовая вкладка — «Чат», она единственная неснимаемая', () => {
    const state = initialTaskTabs();
    expect(state.active).toBe('chat');
    expect(state.files).toEqual([]);
    expect(state.visited).toEqual(['chat']);
    expect(closeTaskFileTab(state, 'nope')).toBe(state);
  });

  it('вложение открывается вкладкой и активируется; повтор — без дубля', () => {
    const opened = openTaskFileTab(initialTaskTabs(), file('a'));
    expect(opened.active).toBe(fileTabId('a'));
    expect(opened.files.map((entry) => entry.fileId)).toEqual(['a']);
    expect(opened.visited).toEqual(['chat', fileTabId('a')]);

    const again = openTaskFileTab(opened, { ...file('a'), name: 'a-v2.docx' });
    expect(again.files).toHaveLength(1);
    expect(again.files[0]!.name).toBe('a-v2.docx');
  });

  it('сверх лимита вытесняется самое давнее неактивное вложение', () => {
    let state = initialTaskTabs();
    for (let index = 0; index < MAX_FILE_TABS; index += 1) {
      state = openTaskFileTab(state, file(`f${index}`));
    }
    state = openTaskFileTab(state, file('fresh'));
    expect(state.files).toHaveLength(MAX_FILE_TABS);
    expect(state.files.some((entry) => entry.fileId === 'f0')).toBe(false);
    expect(state.active).toBe(fileTabId('fresh'));
  });

  it('закрытие активной вкладки уходит к соседу, последней — к «Чату»', () => {
    let state = openTaskFileTab(openTaskFileTab(initialTaskTabs(), file('a')), file('b'));
    state = closeTaskFileTab(state, 'b');
    expect(state.active).toBe(fileTabId('a'));
    expect(state.files.map((entry) => entry.fileId)).toEqual(['a']);
    state = closeTaskFileTab(state, 'a');
    expect(state.active).toBe('chat');
    expect(state.files).toEqual([]);
    expect(state.visited).toEqual(['chat']);
  });

  it('закрытие неактивной вкладки не меняет активную', () => {
    let state = openTaskFileTab(openTaskFileTab(initialTaskTabs(), file('a')), file('b'));
    state = closeTaskFileTab(state, 'a');
    expect(state.active).toBe(fileTabId('b'));
    expect(state.files.map((entry) => entry.fileId)).toEqual(['b']);
  });

  it('активация несуществующего вложения — no-op; разбор id вкладки', () => {
    const state = initialTaskTabs();
    expect(activateTaskTab(state, fileTabId('ghost'))).toBe(state);
    expect(fileIdOf(fileTabId('a'))).toBe('a');
    expect(fileIdOf('chat')).toBeNull();
  });
});
