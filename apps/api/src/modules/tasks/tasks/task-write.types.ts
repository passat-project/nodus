import type { CustomFieldValues, FieldLocks } from '@nodus/contracts';

import type { WorkflowGateFacts } from '../../../core/ports/workflow-entity.port.js';

/**
 * Типы записи задачи (#431): новая строка, патч полей, факты гейтов и
 * перенос стадии. Вынесены из `tasks.repository.ts`, чтобы репозиторий
 * оставался в пределах лимита строк, а сигнатуры писателей жили рядом.
 */

/** Факты гейтов задачи + id сообщений текущей ревизии итога: вложения
 *  считает порт чата (адаптер), поэтому `resultFileCount` добавляет он. */
export type TaskGateFacts = Omit<WorkflowGateFacts, 'resultFileCount' | 'activeCustomFieldIds'> & {
  resultMessageIds: string[];
};

/** Поля новой задачи (участники — вложенным созданием в том же INSERT). */
export interface NewTaskData {
  title: string;
  description: string;
  typeId: string;
  workflowId: string;
  stageId: string;
  systemState: string;
  stageOrder: string;
  priority: string;
  deadline: Date | null;
  plannedMinutes: number | null;
  acceptRequired: boolean;
  creatorId: string;
  assigneeId: string;
  parentId: string | null;
  projectId: string | null;
  /** Узел структуры проекта (#467); null — вне структуры. */
  nodeId: string | null;
  source: string;
  sourceId: string | null;
  checklistTotal: number;
  participants: { userId: string; role: string; muted: boolean }[];
  /** Значения кастомных атрибутов (#431): умолчания + ввод, проверено портом. */
  customFields?: CustomFieldValues;
  /** Замки окна создания (#496, Р4): «Закрепить после создания». */
  fieldLocks?: FieldLocks;
}

/** Правка полей задачи (PATCH): только переданные ключи. */
export interface TaskFieldsPatch {
  title?: string;
  description?: string;
  priority?: string;
  plannedMinutes?: number | null;
  acceptRequired?: boolean;
  parentId?: string | null;
  deadline?: Date | null;
  overdueNotifiedAt?: null;
  assigneeId?: string;
  /** Перенос задачи между проектами (#52 Р4). */
  projectId?: string | null;
  /** Узел структуры проекта (#467); null — «Без узла». */
  nodeId?: string | null;
  /** Полный набор значений кастомных атрибутов после правки (#431). */
  customFields?: CustomFieldValues;
  /** Накопитель замков после разрешённой правки закреплённого (#496). */
  fieldLocks?: FieldLocks;
}

/** Смена стадии задачи (переход маршрута; проверки — у вызывающего). */
export interface TaskStageMove {
  stageId: string;
  systemState: string;
  stageOrder: string;
  stateChangedAt?: Date;
  completedAt: Date | null;
}
