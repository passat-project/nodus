/**
 * Read-порт задач для модуля проектов (ADR-0012, #52 Р11): проекция
 * участия «из задач» (Р2) пересчитывается по событиям task.*, а истину о
 * составе живых задач знает только владелец данных. Модуль projects читает
 * состав через этот порт, не трогая таблицы задач (I3/I6). Провайдер —
 * рядом, экспорт — TasksPortsModule.
 */
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

export const TASK_PROJECT_READER = Symbol('TASK_PROJECT_READER');

/** Роль в задаче, дающая доступ к работе после перевода проекта в секретный. */
export type ProjectTaskHolderRole = 'creator' | 'assignee' | 'coexecutor';

export interface ProjectTaskHolder {
  userId: string;
  roles: ProjectTaskHolderRole[];
  taskCount: number;
}

/** Снимок ролей задач проекта для перевода в секретный (#541): кто станет
 *  участником, кого ждёт действие и кто потеряет доступ наблюдателем. */
export interface ProjectTaskStaffing {
  holders: ProjectTaskHolder[];
  /** Решающие с ожидающим действием (action-кнопки текущего статуса). */
  deciderIds: string[];
  /** Наблюдатели задач: в состав не переносятся, доступ теряют. */
  observers: { userId: string; taskCount: number }[];
}

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

  /** Снимок ролей задач проекта для перевода в секретный (#541): носители
   *  ролей с числом задач, решающие с ожидающим действием, наблюдатели. */
  staffingOf(projectId: string): Promise<ProjectTaskStaffing>;

  /** open→secret: наблюдатели задач, не вошедшие в новый состав, теряют
   *  доступ — их роль снимается в транзакции смены видимости, иначе события
   *  task.* (audience) продолжают уходить им с заголовком задачи (#541). */
  detachObservers(
    tx: TransactionClient,
    projectId: string,
    userIds: readonly string[],
  ): Promise<void>;

  /** projectId живой задачи; null — задачи нет (или удалена). */
  projectIdOf(taskId: string): Promise<string | null>;

  /** Агрегаты прямых задач по узлам структуры проекта (#467): счётчики,
   *  часы и крайние сроки; завершённость — канон isCompletedState (closed &&
   *  outcome не cancelled/rejected, #430). Один GROUP BY, узлы без задач — нули (сервис
   *  дефолтит). */
  nodeRollups(projectId: string): Promise<TaskNodeRollup[]>;

  /** Есть ли в узлах проекта хотя бы одна живая задача (structureSummary
   *  карточки: сводка дерева, #467). */
  hasNodeTasks(projectId: string): Promise<boolean>;

  /** Живые задачи набора узлов (#632, move-preview): формулы папок и
   *  поддерева пересчитываются/сравниваются по ним. `actorId` — фильтр
   *  видимости (конфиденциальные задачи чужих не попадают в диалог, Р7). */
  taskIdsInNodes(
    projectId: string,
    nodeIds: readonly string[],
    actorId?: string,
  ): Promise<string[]>;
}
