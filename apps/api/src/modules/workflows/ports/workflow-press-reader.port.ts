import type { InjectionToken } from '@nestjs/common';
import type {
  EffectiveSection,
  PressConfig,
  TransitionDisplay,
  TransitionForm,
  TransitionFormInput,
  WorkflowTransitionIntent,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/** Результат сверки ввода с личными разделами окна сбора. */
export interface PressInputCheck {
  missing: string[];
  unexpected: string[];
}

/**
 * Кнопка маршрута с настройкой сбора отметок (#434) — read-порт «Процессов»
 * для модуля-владельца сущности: модуль задач не читает `workflow_transitions`
 * напрямую (I3), но должен знать, какую кнопку собирать и по какому окну.
 * Настройка уже разобрана схемой публикации; архивные кнопки сюда не попадают.
 */
export interface WorkflowPressTransition {
  id: string;
  name: string;
  fromStageId: string | null;
  toStageId: string;
  display: TransitionDisplay;
  intent: WorkflowTransitionIntent;
  sortOrder: number;
  /** Снимок окна на момент старта раунда. */
  form: TransitionForm;
  press: PressConfig;
}

export interface WorkflowPressReader {
  /** Коллективные кнопки, выходящие из указанной стадии (обычно одна). */
  pressTransitionsForStage(
    workflowId: string,
    stageId: string,
    tx?: TransactionClient,
  ): Promise<WorkflowPressTransition[]>;

  /** Коллективная кнопка по id — защита прямого выполнения перехода. */
  pressTransition(
    workflowId: string,
    transitionId: string,
    tx?: TransactionClient,
  ): Promise<WorkflowPressTransition | null>;

  /** Личные разделы окна сбора: время, итог, файлы/сообщения, комментарий.
   *  Поля карточки и регистрация в отметку участника не входят (их правит
   *  обычная кнопка/карточка), поэтому ввод сбора сверяется только с ними. */
  personalSections(form: TransitionForm): EffectiveSection[];

  /** Сверка ввода отметки с личными разделами (missing/unexpected-коды). */
  checkPressInput(form: TransitionForm, input: TransitionFormInput): PressInputCheck;
}

export const WORKFLOW_PRESS_READER: InjectionToken = 'WORKFLOW_PRESS_READER';
