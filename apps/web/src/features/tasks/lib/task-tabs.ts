import type { ViewerTarget } from '../../../shared/files/viewer-store.js';

/**
 * Вкладки правой зоны карточки задачи (редизайн 04.11.2026): «Чат» —
 * постоянная вкладка по умолчанию (обсуждение задачи — обычная беседа
 * мессенджера), вложения — закрываемые вкладки, не больше `MAX_FILE_TABS`;
 * седьмое вложение закрывает самую давнюю неактивную. Вкладки монтируются
 * при первом показе и дальше живут скрытыми (`visited`): прокрутка ленты,
 * страница документа и масштаб не теряются. Чистые функции — тестируются
 * без DOM.
 */

export type TaskTabId = 'chat' | `file:${string}`;

export const MAX_FILE_TABS = 6;

export interface TaskTabsState {
  /** Открытые вложения в порядке открытия (порядок вкладок на полосе). */
  files: ViewerTarget[];
  active: TaskTabId;
  /** Хоть раз показанные вкладки — их содержимое смонтировано. */
  visited: TaskTabId[];
}

export const fileTabId = (fileId: string): TaskTabId => `file:${fileId}`;

export function fileIdOf(tab: TaskTabId): string | null {
  return tab.startsWith('file:') ? tab.slice(5) : null;
}

export function initialTaskTabs(): TaskTabsState {
  return { files: [], active: 'chat', visited: ['chat'] };
}

export function activateTaskTab(state: TaskTabsState, tab: TaskTabId): TaskTabsState {
  if (tab !== 'chat' && !state.files.some((file) => fileTabId(file.fileId) === tab)) {
    return state;
  }
  return {
    ...state,
    active: tab,
    visited: state.visited.includes(tab) ? state.visited : [...state.visited, tab],
  };
}

/** Открыть вложение вкладкой (или перейти к уже открытой). */
export function openTaskFileTab(state: TaskTabsState, target: ViewerTarget): TaskTabsState {
  const existing = state.files.find((file) => file.fileId === target.fileId);
  if (existing) {
    return activateTaskTab(
      {
        ...state,
        files: state.files.map((file) => (file.fileId === target.fileId ? target : file)),
      },
      fileTabId(target.fileId),
    );
  }
  let files = state.files;
  if (files.length >= MAX_FILE_TABS) {
    const activeFile = fileIdOf(state.active);
    const evicted = files.find((file) => file.fileId !== activeFile);
    if (evicted) files = files.filter((file) => file.fileId !== evicted.fileId);
  }
  return activateTaskTab({ ...state, files: [...files, target] }, fileTabId(target.fileId));
}

/** Закрыть вкладку вложения; активная уходит к соседу слева (или справа),
 *  без соседей — к «Чату». */
export function closeTaskFileTab(state: TaskTabsState, fileId: string): TaskTabsState {
  const index = state.files.findIndex((file) => file.fileId === fileId);
  if (index < 0) return state;
  const tab = fileTabId(fileId);
  const files = state.files.filter((file) => file.fileId !== fileId);
  const next: TaskTabsState = {
    ...state,
    files,
    visited: state.visited.filter((visited) => visited !== tab),
  };
  if (state.active !== tab) return next;
  const neighbour = files[index - 1] ?? files[index];
  return activateTaskTab(next, neighbour ? fileTabId(neighbour.fileId) : 'chat');
}
