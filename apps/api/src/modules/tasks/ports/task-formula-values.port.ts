import type { InjectionToken } from '@nestjs/common';
import type { FormulaRelationDirection, FormulaRelationKind } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { ConditionRecordData } from '../../custom-fields/ports/condition-records.port.js';
import type {
  FormulaRecordData,
  RecordReadOptions,
} from '../../custom-fields/ports/record-values.port.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';

/**
 * Read-порт задач как источников формул (#632, Р7/Р11). Реализация живёт
 * в tasks (владелец таблицы, I3); custom-fields собирает из портов резолвер
 * движка. Фильтрация видимости (Р7) — здесь: чужие проекты, конфиденциальные
 * и мягко удалённые записи в выборки не попадают (вердикт В1 — для всех).
 * У безпроектной (личной) записи «своё дерево» не определено, поэтому
 * связанные записи фильтруются зоной видимости актора, а без актора выборка
 * пуста (A7-1: «все личные задачи портала» в агрегат не попадают).
 */
export const TASK_FORMULA_VALUES: InjectionToken = 'TASK_FORMULA_VALUES';

export interface TaskFormulaValues {
  /** Задача-источник; actor — проверка видимости (evaluate), null — нет. */
  record(
    id: string,
    opts?: RecordReadOptions,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData | null>;

  /** Подзадачи (Р2 `related{subtasks}`), отфильтрованные Р7. */
  subtasks(
    taskId: string,
    opts?: RecordReadOptions,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]>;

  /** Связанные задачи по виду и направлению связи, отфильтрованные Р7. */
  relatedTasks(
    taskId: string,
    relation: FormulaRelationKind,
    direction: FormulaRelationDirection,
    opts?: RecordReadOptions,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]>;

  /** Задачи папки (Р2 `related{node_tasks}`), отфильтрованные Р7. */
  nodeTasks(
    nodeId: string,
    projectId: string | null,
    tx?: TransactionClient,
  ): Promise<FormulaRecordData[]>;

  /** Полная выборка условий (#635): ВСЕ живые задачи множества — включая
   *  конфиденциальные и невидимые актору (квантор «все» не врёт; причина
   *  фильтрует видимость отдельно, `visibleTaskIds`). Мягко удалённые
   *  исключены всегда; видимость НЕ фильтруется. */
  conditionTasks(
    query:
      | { kind: 'one'; id: string }
      | { kind: 'subtasks_of'; taskId: string }
      | {
          kind: 'related_of';
          taskId: string;
          relation: FormulaRelationKind;
          direction: FormulaRelationDirection;
        }
      | { kind: 'node_tasks'; nodeId: string; projectId: string | null }
      | { kind: 'project_tasks'; projectId: string }
      | { kind: 'ids'; ids: readonly string[] },
    tx?: TransactionClient,
  ): Promise<ConditionRecordData[]>;

  /** Видимые актору задачи из ids (#635, «видимость одна») — та же функция,
   *  что у списка задач. */
  visibleTaskIds(
    ids: readonly string[],
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<ReadonlySet<string>>;
}
