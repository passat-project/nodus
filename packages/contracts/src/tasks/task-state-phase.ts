import {
  taskSystemStateSchema,
  type TaskSystemState,
} from '../workflows/workflow-primitives.schemas.js';

/**
 * Фазы системного состояния задачи (ADR-0020, дополнение 2) — ЕДИНСТВЕННЫЙ
 * источник классификации для API и веба (локальные множества «открытых»
 * состояний и проверки `done || closed` запрещены):
 * - `open` — работа не сдана (backlog / active / paused), ход исполнителя;
 * - `review` — работа сдана и ждёт приёмки (`done` = этап «Утверждение»),
 *   НЕ завершение: утверждающий может вернуть задачу в работу;
 * - `final` — итог (`closed` + исход «выполнена» / «отменена»).
 * Завершение (`completedAt`, `task.completed`) — только вход в `final`;
 * просрочка — только у `open`.
 */
export type TaskStatePhase = 'open' | 'review' | 'final';

const PHASE_OF: Readonly<Record<TaskSystemState, TaskStatePhase>> = {
  backlog: 'open',
  active: 'open',
  paused: 'open',
  done: 'review',
  closed: 'final',
};

const PHASES = new Map<string, TaskStatePhase>(Object.entries(PHASE_OF));

/** Фаза состояния; значение вне закрытого набора — undefined (не
 *  классифицируется молча ни в одну фазу). */
export function taskStatePhase(state: string): TaskStatePhase | undefined {
  return PHASES.get(state);
}

/** Работа не сдана: ход исполнителя, срок может быть просрочен. */
export function isOpenState(state: string): boolean {
  return PHASES.get(state) === 'open';
}

/** Работа сдана и ждёт приёмки — не завершена и не просрочена. */
export function isReviewState(state: string): boolean {
  return PHASES.get(state) === 'review';
}

/** Итог: выполнена или отменена. */
export function isFinalState(state: string): boolean {
  return PHASES.get(state) === 'final';
}

/** Выполнена: итог с исходом «выполнена» (отменённая и отклонённая — не
 *  выполнены; итог без исхода — данные до #378 — считается выполненным). */
export function isCompletedState(state: string, outcome: string | null | undefined): boolean {
  return isFinalState(state) && outcome !== 'cancelled' && outcome !== 'rejected';
}

/** Состояния фазы в порядке оси — новый массив (фильтры `IN (...)` запросов). */
export function statesOfPhase(phase: TaskStatePhase): TaskSystemState[] {
  return taskSystemStateSchema.options.filter((state) => PHASE_OF[state] === phase);
}
