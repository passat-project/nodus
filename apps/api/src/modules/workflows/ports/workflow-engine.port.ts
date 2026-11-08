import type {
  ProcessCategory,
  ProcessType,
  TransitionFormInput,
  WorkflowTransition,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type {
  WorkflowActor,
  WorkflowEntityStage,
} from '../../../core/ports/workflow-entity.port.js';

/** Чем выбран переход: кнопкой, колонкой глобальной доски или колонкой
 *  «Моего плана» (системное состояние + итог; закрытая колонка «Завершённые»
 *  не подменяется «Отменой», #402). */
export type TransitionChoice =
  { transitionId: string } | { stageId: string } | { systemState: string; outcome: string | null };

/** Итог выполнения перехода: целевая стадия и строка журнала (#380). */
export interface TransitionExecution {
  stage: WorkflowEntityStage;
  recordId: string;
  /** Номера, выданные пост-функциями `assign_number {fieldId}` этого
   *  нажатия (#630): только новые — поле с номером кнопка не меняет. */
  assignedNumbers?: { fieldId: string; display: string }[];
}

/**
 * Порт движка маршрутов для модулей-владельцев сущностей (ADR-0012,
 * ADR-0024): доступные переходы и выполнение — В ТРАНЗАКЦИИ ВЫЗЫВАЮЩЕГО.
 * Движок сам ведёт порядок «замок → субъект → условия → гейты → обход →
 * применение адаптером»; чужие таблицы не пишет, журнал переходов добавит
 * #380 в эту же точку.
 */
export const WORKFLOW_ENGINE = Symbol('WORKFLOW_ENGINE');

export interface WorkflowEnginePort {
  /** Кнопки маршрута, доступные актору (условия «кто» пройдены; гейты —
   *  с причинами блокировки). */
  available(
    tx: TransactionClient,
    entityId: string,
    category: ProcessCategory,
    actor: WorkflowActor,
  ): Promise<WorkflowTransition[]>;

  /** Выполнить переход: замок, условия, форма окна, гейты (обход — флаг +
   *  причина), смена стадии адаптером, запись журнала. Возвращает целевую
   *  стадию и id строки журнала. */
  execute(
    tx: TransactionClient,
    entityId: string,
    category: ProcessCategory,
    actor: WorkflowActor,
    choice: TransitionChoice,
    opts?: {
      override?: boolean;
      reason?: string;
      form?: TransitionFormInput;
      /** Человек подтвердил номер с пустой вставкой (#630). */
      confirmEmptyNumberParts?: boolean;
    },
  ): Promise<TransitionExecution>;
}

/** Тип процесса с маршрутом — то, что нужно модулю-владельцу для создания
 *  сущности и смены типа (маршрут типа всегда один — схема «тип → маршрут»). */
export type ProcessTypeWithWorkflow = ProcessType;
