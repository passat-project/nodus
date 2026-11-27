import type {
  TransitionBlockReason,
  WorkflowAction,
  WorkflowDeciderFacts,
  WorkflowTransition,
  WorkflowTransitionRules,
  WorkflowValidator,
  WorkflowValidatorDto,
} from '@nodus/contracts';
import { isFinalState } from '@nodus/contracts';

import type { WorkflowGateFacts } from '../../../../core/ports/workflow-entity.port.js';
import type { ActionDef, StageRow } from '../workflow.repository.js';
import {
  effectiveTargetId,
  evaluateValidators,
  outgoingTransitions,
  passesConditions,
  type AsyncConditionPass,
  type AsyncValidatorReason,
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
  pressTransitionIds?: ReadonlySet<string>;
}

/** Вычисленное вперёд для records/formula (#635): движок считает асинхронно
 *  (по живым данным, видимость актора — в причинах) и передаёт сюда готовые
 *  ответы; чистые вызовы без `gates` видят такие правила fail-closed. */
export interface GateRuntime {
  /** Условия «кто и когда видит кнопку»: истинно ли. */
  conditionsPass?: AsyncConditionPass;
  /** Причины проверок-валидаторов: null — пройдена. */
  validatorReason?: AsyncValidatorReason;
  /** Может ли актор обойти непройденные проверки кнопки (политика #635). */
  canOverrideOf?: (
    validators: readonly WorkflowValidator[],
    blockedBy: readonly TransitionBlockReason[],
  ) => boolean;
}

/** Валидатор → DTO карточки (#635): настройка обхода (extraUserIds — до 50
 *  uuid сотрудников) не уходит каждому, кто видит карточку; обходит ли
 *  актор проверку, решает сервер (`canOverride`). */
export function stripOverride(validator: WorkflowValidator): WorkflowValidatorDto {
  if (validator.kind === 'records') {
    return { kind: validator.kind, title: validator.title, query: validator.query };
  }
  if (validator.kind === 'formula') {
    return { kind: validator.kind, title: validator.title, formula: validator.formula };
  }
  return validator;
}

/** Кнопки текущего статуса с причинами блокировки (#433): чистый сборщик,
 *  вынесенный из движка (лимит I5). */
export function transitionOptions(
  workflow: { stages: readonly StageRow[]; transitions: readonly TransitionDef[] },
  subject: AvailabilitySubject & { facts: WorkflowGateFacts },
  ctx: TargetContext,
  stageOf: (id: string) => StageRow,
  gates?: GateRuntime,
): WorkflowTransition[] {
  return outgoingTransitions(workflow.transitions, subject.facts, workflow.stages, ctx)
    .filter((t) => canShow(t, subject, gates?.conditionsPass))
    .map((t) => {
      const target = stageOf(effectiveTargetId(t, subject.facts, workflow.stages, ctx));
      const blockedBy = [
        ...evaluateValidators(t.rules, subject.facts, gates?.validatorReason),
        ...vacancyReasons(t, subject),
      ];
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
        blockedBy,
        canOverride: gates?.canOverrideOf
          ? gates.canOverrideOf(t.rules.validators, blockedBy)
          : subject.canOverrideGates,
        form: t.form?.enabled ? t.form : null,
        validators: t.rules.validators.map(stripOverride),
      };
    });
}

/**
 * Действия статуса для панели процесса (#633): видимые актору, свои — раньше
 * «из любого», по sortOrder. Действия с шагами пока не исполняются (каталог
 * шагов ядра — отдельная задача) и в карточку не попадают: кнопка, которая
 * всегда падает, хуже отсутствующей.
 *
 * «В любом статусе» — во всех, КРОМЕ завершённых и отменённых (решение
 * владельца 16.11): закрытую запись действие не двигает, а поля и время в неё
 * писать нельзя. Действие, поставленное на закрытый статус явно, работает.
 */
export function actionOptions(
  workflow: { actions: readonly ActionDef[]; stages: readonly StageRow[] },
  subject: AvailabilitySubject & { stageId: string; facts: WorkflowGateFacts },
  gates?: GateRuntime,
): WorkflowAction[] {
  const current = workflow.stages.find((stage) => stage.id === subject.stageId);
  const currentFinal = current ? isFinalState(current.systemState) : false;
  return workflow.actions
    .filter((action) =>
      action.stageId === null ? !currentFinal : action.stageId === subject.stageId,
    )
    .filter(
      (action) =>
        (action.steps as unknown[]).length === 0 && canShow(action, subject, gates?.conditionsPass),
    )
    .sort(
      (a, b) =>
        Number(a.stageId === null) - Number(b.stageId === null) || a.sortOrder - b.sortOrder,
    )
    .map((action) => ({
      id: action.id,
      name: action.name,
      display: action.display,
      form: action.form?.enabled ? action.form : null,
      // Гейты (#740): кнопка видна и объясняет причину до нажатия.
      blockedBy: evaluateValidators(action.rules, subject.facts, gates?.validatorReason),
      validators: action.rules.validators.map(stripOverride),
    }));
}

/**
 * Доступность кнопки перехода (#433) — вынесено из движка, чтобы файл держал
 * лимит I5. Различаем «актор не совпал» и «никого нет»: вакантный переход
 * виден только обладателю права обхода и требует причину (В5).
 */
export function canShow(
  transition: { id: string; rules: WorkflowTransitionRules },
  subject: AvailabilitySubject,
  conditionsPass?: AsyncConditionPass,
): boolean {
  // Коллективная кнопка (#434): состав участников задаёт сам сбор, а не
  // обычные условия «кто»; кнопка видна, пока отметка не сдана.
  if (subject.pressTransitionIds?.has(transition.id)) return true;
  if (conditionsWithoutBypass(transition.rules, subject, conditionsPass)) return true;
  if (subject.vacantDeciderTransitionIds?.has(transition.id)) return subject.canOverrideGates;
  return subject.bypassConditions;
}

/** Причины вакансии: только если условия не прошли иначе (актор не решающий
 *  по роли/праву). */
export function vacancyReasons(
  transition: { id: string; rules: WorkflowTransitionRules },
  subject: AvailabilitySubject,
  conditionsPass?: AsyncConditionPass,
): { kind: 'decider_vacant' }[] {
  if (!subject.vacantDeciderTransitionIds?.has(transition.id)) return [];
  return conditionsWithoutBypass(transition.rules, subject, conditionsPass)
    ? []
    : [{ kind: 'decider_vacant' }];
}

/** Условия «кто» без админского обхода. */
export function conditionsWithoutBypass(
  rules: WorkflowTransitionRules,
  subject: AvailabilitySubject,
  conditionsPass?: AsyncConditionPass,
): boolean {
  return passesConditions(rules, { ...subject, bypassConditions: false }, conditionsPass);
}
