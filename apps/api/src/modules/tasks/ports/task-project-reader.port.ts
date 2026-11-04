/**
 * Read-порт задач для модуля проектов (ADR-0012, #52 Р11): проекция
 * участия «из задач» (Р2) пересчитывается по событиям task.*, а истину о
 * составе живых задач знает только владелец данных. Модуль projects читает
 * состав через этот порт, не трогая таблицы задач (I3/I6). Провайдер —
 * рядом, экспорт — TasksPortsModule.
 */
export const TASK_PROJECT_READER = Symbol('TASK_PROJECT_READER');

/** Агрегаты ПРЯМЫХ задач одного узла (#467): GROUP BY на стороне владельца. */
export interface TaskNodeRollup {
  nodeId: string;
  taskCount: number;
  doneCount: number;
  plannedMinutes: number;
  spentMinutes: number;
  /** ISO-строки; null — значений нет. */
  nearestDeadline: string | null;
  latestDeadline: string | null;
}

export interface TaskProjectReader {
  /** Действующие участники задач проекта БЕЗ наблюдателей (Р2, вердикт
   *  29.10): постановщик, ответственный, соисполнители живых задач;
   *  уникальные id. Пустой массив — задач нет. */
  membersOf(projectId: string): Promise<string[]>;

  /** ВСЕ носители ролей задач проекта (включая наблюдателей) — гейт снятия
   *  из секретного проекта: иначе снятый продолжает получать push/уведомления
   *  по задачам (security #52). */
  roleHolderIds(projectId: string): Promise<string[]>;

  /** projectId живой задачи; null — задачи нет (или удалена). */
  projectIdOf(taskId: string): Promise<string | null>;

  /** Агрегаты прямых задач по узлам структуры проекта (#467): счётчики,
   *  часы и крайние сроки; завершённость — канон isCompletedState (closed &&
   *  outcome ≠ cancelled). Один GROUP BY, узлы без задач — нули (сервис
   *  дефолтит). */
  nodeRollups(projectId: string): Promise<TaskNodeRollup[]>;

  /** Есть ли в узлах проекта хотя бы одна живая задача (structureSummary
   *  карточки: сводка дерева, #467). */
  hasNodeTasks(projectId: string): Promise<boolean>;
}
