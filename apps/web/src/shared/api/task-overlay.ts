import { useSyncExternalStore } from 'react';
import type { TaskListItem } from '@nodus/contracts';

import { registerSessionReset } from '../session-reset.js';

/**
 * Оверлей досок (#1051): самые свежие строки задач — оптимистичные правки и
 * ответы сервера — поверх локального состояния борда. Борд канбана живёт в
 * `useState` движка и иначе узнаёт о правках только из перезапрошенных страниц
 * колонок (сеть): имя и приоритет на карточке отставали от карточки задачи на
 * два круга. Оверлей показывает правку в тот же кадр, без запроса.
 *
 * Запись живёт, пока свежая страница колонки не принесёт задачу (доска
 * вызывает `consumeTaskItems`). Оптимистичную запись свежая страница НЕ
 * снимает: перезапрос, летящий во время мутации, вернул старое значение — оно
 * не должно мигнуть. Ответ сервера заменяет оптимистичную запись, ошибка
 * мутации возвращает прежнюю строку (`restoreTaskOverlay`).
 */
interface OverlayEntry {
  task: TaskListItem;
  optimistic: boolean;
}

const entries = new Map<string, OverlayEntry>();
const listeners = new Set<() => void>();
let version = 0;

function bump(): void {
  version += 1;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => version;

/** Строка задачи поверх борда; `optimistic` — правка ещё не подтверждена. */
export function publishTaskItem(task: TaskListItem, optimistic = false): void {
  const entry = entries.get(task.id);
  if (!optimistic && entry?.optimistic === false && entry.task === task) return;
  entries.set(task.id, { task, optimistic });
  bump();
}

/** Серверские страницы пришли в борд — их записи оверлея больше не нужны. */
export function consumeTaskItems(ids: Iterable<string>): void {
  let changed = false;
  for (const id of ids) {
    const entry = entries.get(id);
    if (entry && !entry.optimistic && entries.delete(id)) changed = true;
  }
  if (changed) bump();
}

export function taskOverlayItem(id: string): TaskListItem | undefined {
  return entries.get(id)?.task;
}

/** Версия оверлея: подписка доски (ре-рендер только на реальную публикацию). */
export function useTaskOverlayVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Чистое применение: борд + оверлей (та же ссылка, когда накладывать нечего). */
export function applyTaskOverlay(items: readonly TaskListItem[]): TaskListItem[] {
  if (entries.size === 0) return items as TaskListItem[];
  return items.map((task) => {
    const entry = entries.get(task.id);
    return entry && entry.task !== task ? entry.task : task;
  });
}

/** Тесты; сессия — через `registerSessionReset` ниже. */
export function resetTaskOverlay(): void {
  if (entries.size === 0) return;
  entries.clear();
  bump();
}

// Единая точка сброса сессии (выход, мёртвая сессия, чужой refresh): оверлей —
// память модуля, `queryClient.clear()` её не трогает; неподтверждённая правка
// предыдущего пользователя не должна показаться следующему.
registerSessionReset(resetTaskOverlay);
