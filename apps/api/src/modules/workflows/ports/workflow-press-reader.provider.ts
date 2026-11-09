import { Injectable } from '@nestjs/common';
import {
  effectiveWindowSections,
  PRESS_WINDOW_SECTION_KINDS,
  type EffectiveSection,
  type PressConfig,
  type TransitionForm,
  type TransitionFormInput,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { checkFormInput } from '../workflow/transition-form.js';
import type { TransitionDef } from '../workflow/transition-rules.js';
import { WorkflowRepository } from '../workflow/workflow.repository.js';
import type {
  PressInputCheck,
  WorkflowPressReader,
  WorkflowPressTransition,
} from './workflow-press-reader.port.js';

/** Личные разделы отметки: что участник пишет «про своё». */
const PRESS_SECTION_KINDS = new Set<string>(PRESS_WINDOW_SECTION_KINDS);

/**
 * Реализация `WORKFLOW_PRESS_READER` (#434): читает живой маршрут тем же
 * репозиторием движка (публикация действует сразу, кэша нет) и отдаёт только
 * кнопки с настройкой сбора. `form` — разобранное окно; `press` — уже
 * опубликованная схема (пустые источники не проходят публикацию).
 */
@Injectable()
export class WorkflowPressReaderProvider implements WorkflowPressReader {
  constructor(private readonly workflows: WorkflowRepository) {}

  async pressTransitionsForStage(
    workflowId: string,
    stageId: string,
    tx?: TransactionClient,
  ): Promise<WorkflowPressTransition[]> {
    const loaded = await this.workflows.load(workflowId, tx);
    return loaded.transitions.flatMap((transition) =>
      transition.press !== null &&
      transition.press !== undefined &&
      transition.fromStageId === stageId
        ? [this.viewOf(transition, transition.press)]
        : [],
    );
  }

  async pressTransition(
    workflowId: string,
    transitionId: string,
    tx?: TransactionClient,
  ): Promise<WorkflowPressTransition | null> {
    const loaded = await this.workflows.load(workflowId, tx);
    const transition = loaded.transitions.find((item) => item.id === transitionId);
    if (!transition?.press) return null;
    return this.viewOf(transition, transition.press);
  }

  private viewOf(transition: TransitionDef, press: PressConfig): WorkflowPressTransition {
    return {
      id: transition.id,
      name: transition.name,
      fromStageId: transition.fromStageId,
      toStageId: transition.toStageId,
      display: transition.display,
      intent: transition.intent,
      sortOrder: transition.sortOrder,
      form: transition.form ?? { enabled: false, sections: [] },
      press,
    };
  }

  personalSections(form: TransitionForm): EffectiveSection[] {
    return effectiveWindowSections(form.enabled ? form : null, { validators: [] }).filter(
      (section) => PRESS_SECTION_KINDS.has(section.kind),
    );
  }

  checkPressInput(form: TransitionForm, input: TransitionFormInput): PressInputCheck {
    const check = checkFormInput(this.personalSections(form), input);
    return { missing: check.missing, unexpected: check.unexpected };
  }
}
