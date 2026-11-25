import { useSyncExternalStore } from 'react';
import type { TaskListItem } from '@nodus/contracts';

import { registerSessionReset } from '../session-reset.js';

/**
 * Оверлей досок (#1051): правки строки задачи поверх ЛОКАЛЬНОГО состояния
 * борда. Борд канбана живёт в `useState` движка и иначе узнаёт о правках
 * только из перезапрошенных страниц колонок (сеть): имя и приоритет на
 * карточке отставали от карточки задачи на два круга.
 *
 * Два вида записей:
 * - патч полей (`publishTaskPatch`) — оптимистичная правка: накладывается на
 *   ту строку, что уже лежит в борде, в том числе на карточку, догруженную
 *   sentinel-ом (её нет ни в одном кэше). Строку целиком оверлей не приносит:
 *   в кэше журнала задача могла остаться в прежней колонке, и цельная строка
 *   уводила карточку обратно;
 * - строка сервера (`publishTaskItem`) — ответ мутации: заменяет поля карточки.
 * Размещение (колонка, личная колонка) всегда остаётся за бордом и страницами
 * колонок — оверлей не может вернуть карточку в прежнюю колонку, пока перенос
 * в полёте.
 *
 * Запись живёт, пока свежая страница колонки не принесёт задачу (доска
 * вызывает `consumeTaskItems`). Оптимистичную запись свежая страница НЕ
 * снимает: перезапрос, летящий во время мутации, вернул старое значение — оно
 * не должно мигнуть. Ответ сервера заменяет оптимистичную запись, ошибка
 * мутации возвращает прежнюю (`restoreTaskOverlay`).
 */
export type TaskFacePatch = Partial<TaskListItem>;

type OverlayEntry =
  | { kind: 'patch'; patch: TaskFacePatch; optimistic: boolean }
  | { kind: 'row'; task: TaskListItem };

/** Прежняя запись задачи — для отката (`restoreTaskOverlay`). */
export interface OverlayToken {
  readonly id: string;
  readonly entry: OverlayEntry | undefined;
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

function replace(id: string, entry: OverlayEntry): OverlayToken {
  const previous = entries.get(id);
  entries.set(id, entry);
  bump();
  return { id, entry: previous };
}

/** Патч полей строки на досках; `optimistic = false` — итоговое значение без
 *  ответа сервера (сервер вернул не строку задачи, а часть: пункт чек-листа):
 *  такую запись снимает следующая свежая страница колонки. */
export function publishTaskPatch(
  taskId: string,
  patch: TaskFacePatch,
  optimistic = true,
): OverlayToken {
  return replace(taskId, { kind: 'patch', patch, optimistic });
}

/** Строка сервера (ответ мутации) — во все доски, где задача лежит. */
export function publishTaskItem(task: TaskListItem): OverlayToken {
  const current = entries.get(task.id);
  if (current?.kind === 'row' && current.task === task) return { id: task.id, entry: current };
  return replace(task.id, { kind: 'row', task });
}

/** Откат: вернуть прежнюю запись (или её отсутствие). */
export function restoreTaskOverlay(token: OverlayToken | undefined): void {
  if (!token) return;
  if (token.entry) entries.set(token.id, token.entry);
  else entries.delete(token.id);
  bump();
}

/** Серверские страницы пришли в борд — их записи оверлея больше не нужны. */
export function consumeTaskItems(ids: Iterable<string>): void {
  let changed = false;
  for (const id of ids) {
    const entry = entries.get(id);
    const optimistic = entry?.kind === 'patch' && entry.optimistic;
    if (entry && !optimistic && entries.delete(id)) changed = true;
  }
  if (changed) bump();
}

export function hasTaskOverlay(id: string): boolean {
  return entries.has(id);
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
    if (!entry) return task;
    const placement = { stage: task.stage, personalStageId: task.personalStageId };
    return entry.kind === 'patch'
      ? { ...task, ...entry.patch, ...placement }
      : { ...entry.task, ...placement };
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
