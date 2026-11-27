import {
  ErrorCode,
  type ProcessCategory,
  type ProjectRole,
  type TransitionBlockReason,
  type WorkflowCondition,
  type WorkflowValidator,
} from '@nodus/contracts';

import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import { DomainException } from '../../../../core/errors/domain-exception.js';
import type { WorkflowActor } from '../../../../core/ports/workflow-entity.port.js';
import type { LoadedWorkflow } from '../workflow.repository.js';
import type { ConditionEvaluator } from '../conditions/evaluator.service.js';
import { overrideAllowed } from '../conditions/override-policy.js';
import type { AsyncConditionPass, AsyncValidatorReason } from '../transition-rules.js';
import type { GateRuntime } from './transition-availability.js';

type ConditionGate = Extract<WorkflowValidator, { kind: 'records' | 'formula' }>;

/** Субъект движка + проектные роли (политики обхода #635). */
export type GatesSubject = {
  canOverrideGates: boolean;
  projectRoles?: ReadonlySet<ProjectRole>;
};

/**
 * Предвычисление records/formula правил (#635) для чистых сборщиков кнопок:
 * условия «кто и когда видит» и причины проверок асинхронны (живые данные,
 * видимость актора) — движок считает их здесь и подаёт готовые ответы.
 * `withValidators: false` — только условия (execute до окна: причины
 * считаются ПОСЛЕ окна по свежим данным, отдельным вызовом). Без новых видов
 * правил — пустой рантайм, ни одного лишнего запроса.
 */
export async function precomputeGates(args: {
  evaluator: ConditionEvaluator;
  tx: TransactionClient;
  workflow: LoadedWorkflow;
  subject: GatesSubject;
  entityId: string;
  category: ProcessCategory;
  actor: WorkflowActor;
  withValidators: boolean;
}): Promise<GateRuntime> {
  const { evaluator, tx, workflow, subject, entityId, category, actor, withValidators } = args;
  const owners: readonly { rules: { conditions: unknown[]; validators: unknown[] } }[] = [
    ...workflow.transitions,
    // Старые фикстуры/моки могут приходить без действий — tolerant read.
    ...(workflow.actions ?? []),
  ];
  const isAsync = (rule: unknown): boolean =>
    typeof rule === 'object' &&
    rule !== null &&
    ((rule as { kind?: string }).kind === 'records' ||
      (rule as { kind?: string }).kind === 'formula');
  const hasConditions = owners.some((owner) => owner.rules.conditions.some(isAsync));
  const hasValidators =
    withValidators && owners.some((owner) => owner.rules.validators.some(isAsync));
  if (!hasConditions && !hasValidators) return {};
  const runtime = await evaluator.runtime(tx, { kind: category, id: entityId }, actor);

  const conditionResults = new Map<string, boolean>();
  if (hasConditions) {
    const seen = new Set<string>();
    for (const owner of owners) {
      for (const condition of owner.rules.conditions.filter(isAsync) as Extract<
        WorkflowCondition,
        { kind: 'records' | 'formula' }
      >[]) {
        const key = JSON.stringify(condition);
        if (seen.has(key)) continue;
        seen.add(key);
        conditionResults.set(key, await runtime.conditionPasses(condition));
      }
    }
  }
  const validatorResults = new Map<string, TransitionBlockReason | null>();
  if (hasValidators) {
    const seen = new Set<string>();
    for (const owner of owners) {
      for (const validator of owner.rules.validators.filter(isAsync) as ConditionGate[]) {
        const key = JSON.stringify(validator);
        if (seen.has(key)) continue;
        seen.add(key);
        validatorResults.set(key, await runtime.validatorReason(validator));
      }
    }
  }
  const conditionsPass: AsyncConditionPass | undefined = hasConditions
    ? (condition) => conditionResults.get(JSON.stringify(condition)) ?? false
    : undefined;
  const validatorReason: AsyncValidatorReason | undefined = hasValidators
    ? (validator) => validatorResults.get(JSON.stringify(validator))
    : undefined;
  return {
    ...(conditionsPass ? { conditionsPass } : {}),
    ...(validatorReason ? { validatorReason } : {}),
    canOverrideOf: (validators, blockedBy) =>
      overrideAllowed(blockedBy, failedValidatorsOf(validators, validatorReason), subject, actor.id)
        .allowed,
  };
}

/** Непройденные проверки кнопки (#635): политика обхода спрашивается только
 *  у них — ПРОЙДЕННАЯ проверка прав не даёт (её extraUserIds не открывают
 *  обход другой, непройденной) и не отбирает (её forbidden не запрещает).
 *  Прежние гейты проходят как есть: их допуск решает право, по kinds причин.
 *  Сверка идёт по вычисленной причине валидатора, а не по виду: у одной
 *  кнопки может быть несколько проверок records/formula. */
export function failedValidatorsOf(
  validators: readonly WorkflowValidator[],
  validatorReason: AsyncValidatorReason | undefined,
): readonly WorkflowValidator[] {
  return validators.filter((validator) => {
    if (validator.kind !== 'records' && validator.kind !== 'formula') return true;
    return (validatorReason?.(validator) ?? null) !== null;
  });
}

/** Обход гейтов (#378; #635 — политика каждой непройденной проверки):
 *  409 без флага обхода (причины — в details); forbidden-проверка не пускает
 *  никого (403 WORKFLOW_GATE_OVERRIDE_FORBIDDEN); далее допуск политики
 *  (право/руководство/роль/доп. сотрудники) и обязательная причина.
 *  Политику спрашивают только НЕПРОЙДЕННЫЕ проверки кнопки: `gates` несёт
 *  вычисленные причины (failedValidatorsOf), пройденная проверка прав не
 *  даёт (extraUserIds) и не отбирает (forbidden). */
export function assertGateOverride(
  reasons: readonly TransitionBlockReason[],
  subject: GatesSubject,
  actorId: string,
  gates: GateRuntime | undefined,
  validators: readonly WorkflowValidator[],
  opts: { override?: boolean; reason?: string },
): void {
  if (!opts.override) {
    throw new DomainException(
      ErrorCode.WORKFLOW_TRANSITION_BLOCKED,
      'Transition gates not passed',
      { reasons },
    );
  }
  const { allowed, forbidden } = overrideAllowed(
    reasons,
    failedValidatorsOf(validators, gates?.validatorReason),
    subject,
    actorId,
  );
  if (forbidden) {
    throw new DomainException(
      ErrorCode.WORKFLOW_GATE_OVERRIDE_FORBIDDEN,
      'Gate override is forbidden by check settings',
    );
  }
  if (!allowed) {
    throw DomainException.forbidden('Gate override requires task.override_gate');
  }
  if (!opts.reason?.trim()) {
    throw new DomainException(
      ErrorCode.WORKFLOW_OVERRIDE_REASON_REQUIRED,
      'Override reason required',
    );
  }
}
