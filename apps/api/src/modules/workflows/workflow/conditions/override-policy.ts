import type { ProjectRole, TransitionBlockReason, WorkflowValidator } from '@nodus/contracts';

/**
 * Политика обхода проверок общей выборки (#635): `forbidden` — не обходит
 * никто (даже task.override_gate); `default` — руководство проекта записи
 * (руководитель/помощники) ∪ обладатели `task.override_gate` ∪ доп.
 * сотрудники ∪ держатели роли в проекте. Причина обязательна всегда — её
 * требует движок (409 → причина → история записи и проекта). Чистая функция:
 * факты субъекта собирают адаптеры категорий, движок только применяет.
 */

/** Факты субъекта, нужные политике (подмножество WorkflowActorSubject). */
export interface OverrideSubject {
  /** Обладатель `task.override_gate` (нет флага — false). */
  canOverrideGates?: boolean;
  /** Роли актора в проекте записи: `manager`/`assistant` — руководство. */
  projectRoles?: ReadonlySet<ProjectRole>;
}

/** Шесть прежних видов гейтов (#378) — без настройки обхода. */
export const LEGACY_GATE_KINDS = new Set([
  'no_open_subtasks',
  'checklist_complete',
  'fields_required',
  'time_logged',
  'result_present',
  'result_files',
]);

export function isConditionGateKind(kind: string): boolean {
  return kind === 'records' || kind === 'formula';
}

/** Руководство проекта записи: руководитель или помощник (#635). */
export function isProjectManagement(subject: OverrideSubject): boolean {
  return (
    subject.projectRoles?.has('manager') === true || subject.projectRoles?.has('assistant') === true
  );
}

/**
 * Пропустят ли актора непройденные проверки. Для прежних гейтов — только
 * `task.override_gate`; для records/formula — политика каждого непройденного
 * (forbidden где-то = не пускает никого). Прежние и новые проверяются
 * независимо: право на все прежние И допуск политики всех новых.
 */
export function overrideAllowed(
  failed: readonly TransitionBlockReason[],
  validators: readonly WorkflowValidator[],
  subject: OverrideSubject,
  actorId: string,
): { allowed: boolean; forbidden: boolean } {
  const failedKinds = new Set(failed.map((reason) => reason.kind));
  const legacyFailed = [...failedKinds].some((kind) => LEGACY_GATE_KINDS.has(kind));
  const gates = validators.filter(
    (validator): validator is Extract<WorkflowValidator, { kind: 'records' | 'formula' }> =>
      isConditionGateKind(validator.kind) && failedKinds.has(validator.kind),
  );
  // forbidden перекрывает всё: даже обладатель права не проходит.
  if (gates.some((gate) => gate.override.mode === 'forbidden')) {
    return { allowed: false, forbidden: true };
  }
  let policyAllows = true;
  if (gates.length > 0) {
    policyAllows =
      subject.canOverrideGates === true ||
      isProjectManagement(subject) ||
      gates.some((gate) => gate.override.extraUserIds.includes(actorId)) ||
      gates.some(
        (gate) =>
          gate.override.projectRole !== undefined &&
          subject.projectRoles?.has(gate.override.projectRole) === true,
      );
  }
  const legacyAllows = !legacyFailed || subject.canOverrideGates === true;
  return { allowed: legacyAllows && policyAllows, forbidden: false };
}
