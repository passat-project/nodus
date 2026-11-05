import type {
  WorkflowDeciderFacts,
  WorkflowTransition,
  WorkflowTransitionRules,
} from '@nodus/contracts';

import type { WorkflowGateFacts } from '../../../../core/ports/workflow-entity.port.js';
import type { StageRow } from '../workflow.repository.js';
import {
  effectiveTargetId,
  evaluateValidators,
  outgoingTransitions,
  passesConditions,
  type TargetContext,
  type TransitionDef,
} from '../transition-rules.js';

/** Минимум субъекта для проверки доступности перехода (движок передаёт
 *  полный `EngineSubject`). */
export interface AvailabilitySubject {
  roles: ReadonlySet<string>;
  permissions: readonly string[];
  bypassConditions: boolean;
  actsWithoutConditions: boolean;
  canOverrideGates: boolean;
  deciderFacts?: WorkflowDeciderFacts;
  vacantDeciderTransitionIds?: ReadonlySet<string>;
}

/** Кнопки текущего статуса с причинами блокировки (#433): чистый сборщик,
 *  вынесенный из движка (лимит I5). */
export function transitionOptions(
  workflow: { stages: readonly StageRow[]; transitions: readonly TransitionDef[] },
  subject: AvailabilitySubject & { facts: WorkflowGateFacts },
  ctx: TargetContext,
  stageOf: (id: string) => StageRow,
): WorkflowTransition[] {
  return outgoingTransitions(workflow.transitions, subject.facts, workflow.stages, ctx)
    .filter((t) => canShow(t, subject))
    .map((t) => {
      const target = stageOf(effectiveTargetId(t, subject.facts, workflow.stages, ctx));
      return {
        id: t.id,
        name: t.name,
        toStageId: target.id,
        toStageName: target.name,
        toStageState: target.systemState as WorkflowTransition['toStageState'],
        toStageOutcome: (target.outcome ?? null) as WorkflowTransition['toStageOutcome'],
        toStageColor: target.color as WorkflowTransition['toStageColor'],
        toStageOrder: target.sortOrder,
        display: t.display,
        intent: t.intent,
        blockedBy: [...evaluateValidators(t.rules, subject.facts), ...vacancyReasons(t, subject)],
        canOverride: subject.canOverrideGates,
        form: t.form?.enabled ? t.form : null,
        validators: t.rules.validators,
      };
    });
}

/**
 * Доступность кнопки перехода (#433) — вынесено из движка, чтобы файл держал
 * лимит I5. Различаем «актор не совпал» и «никого нет»: вакантный переход
 * виден только обладателю права обхода и требует причину (В5).
 */
export function canShow(
  transition: { id: string; rules: WorkflowTransitionRules },
  subject: AvailabilitySubject,
): boolean {
  if (conditionsWithoutBypass(transition.rules, subject)) return true;
  if (subject.vacantDeciderTransitionIds?.has(transition.id)) return subject.canOverrideGates;
  return subject.bypassConditions;
}

/** Причины вакансии: только если условия не прошли иначе (актор не решающий
 *  по роли/праву). */
export function vacancyReasons(
  transition: { id: string; rules: WorkflowTransitionRules },
  subject: AvailabilitySubject,
): { kind: 'decider_vacant' }[] {
  if (!subject.vacantDeciderTransitionIds?.has(transition.id)) return [];
  return conditionsWithoutBypass(transition.rules, subject) ? [] : [{ kind: 'decider_vacant' }];
}

/** Условия «кто» без админского обхода. */
export function conditionsWithoutBypass(
  rules: WorkflowTransitionRules,
  subject: AvailabilitySubject,
): boolean {
  return passesConditions(rules, { ...subject, bypassConditions: false });
}
