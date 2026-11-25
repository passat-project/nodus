import type { QueryClient } from '@tanstack/react-query';

import { kanbanColumnPrefix } from '../lib/board/kanban-column-key.js';
import { registerSessionReset } from '../session-reset.js';
import { projectsKeys } from './projects-list.js';
import { tasksKeys } from './tasks-keys.js';

/**
 * Одна правка задачи — один раунд перезапросов (#1051). Прежде мутация
 * инвалидила десять ключей «молотком» (все доски, все деревья, журнал), а
 * эхо собственного события по WebSocket инвалидировало то же повторно: на
 * одно изменение имени клиент делал 14–17 запросов двумя волнами, и каждый
 * ответ пересобирал экран.
 *
 * Теперь: (1) то, что мутация знает лучше эха, перезапрашивается сразу и с
 * меткой времени — эхо того же ключа в окне TTL пропускается батчером
 * (`wasInvalidatedRecently`); (2) доски, журнал и ветки помечаются
 * устаревшими без перезапроса — их догоняет единственный раунд от эха
 * (сервер шлёт событие и актёру); без сокета — при следующем монтировании
 * или фокусе окна.
 */

const recently = new Map<string, number>();
const RECENT_TTL_MS = 2_000;

const stampOf = (key: readonly unknown[]) => JSON.stringify(key);

/** Перезапросить сейчас и запомнить момент: эхо не повторит этот круг. */
export function invalidateNow(
  queryClient: QueryClient,
  key: readonly unknown[],
  options?: { exact?: boolean },
): Promise<void> {
  recently.set(stampOf(key), Date.now());
  return queryClient.invalidateQueries({ queryKey: key, ...options });
}

/** Пометить устаревшим без перезапроса — догонит эхо, монтирование или фокус. */
export function markStale(queryClient: QueryClient, key: readonly unknown[]): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });
}

/** Ключ только что перезапрошен своей мутацией — эхо его пропускает. */
export function wasInvalidatedRecently(key: readonly unknown[], at = Date.now()): boolean {
  const stamp = stampOf(key);
  const at0 = recently.get(stamp);
  if (at0 === undefined) return false;
  if (at - at0 >= RECENT_TTL_MS) {
    recently.delete(stamp);
    return false;
  }
  return true;
}

/** Страница колонки могла прилететь, пока перенос был в полёте, — и застать
 *  задачу в прежней колонке. Момент ответа переноса: всё, что пришло в кэш
 *  РАНЬШЕ, доска не применяет (см. use-kanban-feeds). */
let moveSettledAt = 0;

export function markBoardMoveSettled(at = Date.now()): number {
  moveSettledAt = at;
  return moveSettledAt;
}

export function boardMoveSettledAt(): number {
  return moveSettledAt;
}

/** Колонки доски — свежей страницей после ответа переноса: летящий перезапрос
 *  отменяется (он застал бы задачу в прежней колонке), новый идёт уже по
 *  состоянию сервера. С меткой времени — повторный раунд от эха не нужен. */
export function refetchBoardColumns(queryClient: QueryClient, boardKey: readonly unknown[]): void {
  const prefix = kanbanColumnPrefix(boardKey);
  for (const query of queryClient.getQueryCache().findAll({ queryKey: prefix })) {
    recently.set(stampOf(query.queryKey), Date.now());
  }
  void queryClient.refetchQueries({ queryKey: prefix }, { cancelRefetch: true });
}

export interface TaskMutationEffects {
  /** Срок меняет «просрочено» в каталогах стадий. */
  deadline?: boolean;
  /** Плановое время — агрегаты узлов структуры проекта. */
  plannedMinutes?: boolean;
  /** Атрибуты и состав задачи кормят агрегаты узлов (прогресс, часы). */
  structure?: boolean;
}

/** Завершение мутации задачи: точечные ключи сразу, остальное — за эхом. */
export function invalidateAfterTaskMutation(
  queryClient: QueryClient,
  taskId: string,
  effects: TaskMutationEffects = {},
): void {
  // Гейты переходов и действий читут поля задачи — кнопки обязаны догнать сразу.
  void invalidateNow(queryClient, tasksKeys.detail(taskId));
  void invalidateNow(queryClient, tasksKeys.transitions(taskId));
  void invalidateNow(queryClient, tasksKeys.actions(taskId));
  if (effects.deadline) {
    void invalidateNow(queryClient, tasksKeys.personalStages());
    void invalidateNow(queryClient, tasksKeys.stages());
  }
  if (effects.plannedMinutes || effects.structure) {
    void invalidateNow(queryClient, projectsKeys.structures());
  }
  void markStale(queryClient, tasksKeys.kanbanAll());
  void markStale(queryClient, tasksKeys.listPages());
  void markStale(queryClient, tasksKeys.branchAll());
}

/** Тесты; сессия — через `registerSessionReset` ниже. */
export function resetRecentInvalidations(): void {
  recently.clear();
  moveSettledAt = 0;
}

// Единая точка сброса сессии (выход, мёртвая сессия, чужой refresh): метка
// «перезапрошено своей мутацией» предыдущего пользователя иначе погасила бы
// первый раунд эха следующего.
registerSessionReset(resetRecentInvalidations);
