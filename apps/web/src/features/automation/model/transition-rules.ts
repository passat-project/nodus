import type {
  WorkflowActorRole,
  WorkflowFieldKey,
  WorkflowRequirableField,
  WorkflowDraftDocument,
  WorkflowDraftTransition,
  WorkflowValidator,
} from '@nodus/contracts';
import { CUSTOM_FIELD_LIMITS } from '@nodus/contracts';

/**
 * Чистые правки правил кнопки (#378): кто видит (роли — минимум одна),
 * условия перехода (DoR/DoD-валидаторы, поля, мягкий гейт подзадач
 * `allowReview`), особое правило `route_if` «постановщик сам себе
 * исполнитель». Панель только вызывает их и патчит rules целиком.
 */

type Rules = WorkflowDraftTransition['rules'];

export const ACTOR_ROLES: readonly WorkflowActorRole[] = [
  'creator',
  'assignee',
  'coexecutor',
  'observer',
];
export const VALIDATOR_KINDS = [
  'no_open_subtasks',
  'checklist_complete',
  'time_logged',
  'result_present',
  'result_files',
  'fields_required',
] as const;
export type ValidatorKind = (typeof VALIDATOR_KINDS)[number];
export const REQUIRABLE_FIELDS: readonly WorkflowRequirableField[] = [
  'description',
  'deadline',
  'assignee',
  'plannedMinutes',
  'result',
];

export function rolesOf(rules: Rules): Set<WorkflowActorRole> {
  return new Set(rules.conditions.flatMap((c) => (c.kind === 'role_in' ? c.roles : [])));
}

/** Роль вкл/выкл; последнюю снять нельзя (кнопку должен кто-то видеть).
 *  `allowed` — словарь ролей категории (Р6): у письма свои роли, чужие из
 *  документа не переживают правку. */
export function toggleRole(
  rules: Rules,
  role: WorkflowActorRole,
  allowed: readonly WorkflowActorRole[] = ACTOR_ROLES,
): Rules {
  const roles = rolesOf(rules);
  if (roles.has(role)) roles.delete(role);
  else roles.add(role);
  if (roles.size === 0) return rules;
  const list = allowed.filter((r) => roles.has(r));
  const others = rules.conditions.filter((c) => c.kind !== 'role_in');
  return { ...rules, conditions: [{ kind: 'role_in', roles: list }, ...others] };
}

export function validatorOf<K extends WorkflowValidator['kind']>(
  rules: Rules,
  kind: K,
): Extract<WorkflowValidator, { kind: K }> | undefined {
  return rules.validators.find(
    (v): v is Extract<WorkflowValidator, { kind: K }> => v.kind === kind,
  );
}

export function toggleValidator(rules: Rules, kind: ValidatorKind): Rules {
  if (validatorOf(rules, kind)) {
    return { ...rules, validators: rules.validators.filter((v) => v.kind !== kind) };
  }
  const added: WorkflowValidator =
    kind === 'fields_required'
      ? { kind, fields: ['description'] }
      : kind === 'result_files'
        ? { kind, min: 1 }
        : { kind };
  return { ...rules, validators: [...rules.validators, added] };
}

/** «Минимум файлов» гейта result_files (0 — снять условие). */
export function setMinFiles(rules: Rules, min: number): Rules {
  const validator = validatorOf(rules, 'result_files');
  if (min <= 0) {
    return { ...rules, validators: rules.validators.filter((v) => v.kind !== 'result_files') };
  }
  const next = Math.min(5, Math.max(1, Math.round(min)));
  if (!validator)
    return { ...rules, validators: [...rules.validators, { kind: 'result_files', min: next }] };
  return {
    ...rules,
    validators: rules.validators.map((v) =>
      v.kind === 'result_files' ? { kind: v.kind, min: next } : v,
    ),
  };
}

/** Мягкий гейт: подзадачи на утверждении не мешают (по умолчанию — мешают). */
export function setAllowReview(rules: Rules, allow: boolean): Rules {
  return {
    ...rules,
    validators: rules.validators.map((v) =>
      v.kind === 'no_open_subtasks' ? (allow ? { ...v, allowReview: true } : { kind: v.kind }) : v,
    ),
  };
}

/** Поле обязательного заполнения вкл/выкл (последнее не снимается). Ключи
 *  системных полей и `cf.<id>` (#431) живут в одном массиве; лимит — 20 (Р7). */
export function toggleField(rules: Rules, field: WorkflowFieldKey): Rules {
  const validator = validatorOf(rules, 'fields_required');
  if (!validator) return rules;
  const fields = new Set<string>(validator.fields);
  if (fields.has(field)) fields.delete(field);
  else {
    if (fields.size >= CUSTOM_FIELD_LIMITS.gateFields) return rules;
    fields.add(field);
  }
  if (fields.size === 0) return rules;
  return {
    ...rules,
    validators: rules.validators.map((v) =>
      v.kind === 'fields_required'
        ? { kind: v.kind, fields: [...fields] as WorkflowFieldKey[] }
        : v,
    ),
  };
}

export function routeIfOf(rules: Rules): string | null {
  const rule = rules.postFunctions.find((p) => p.kind === 'route_if');
  return rule && rule.kind === 'route_if' ? rule.toStageId : null;
}

/** Условие пропуска (#430): по полям (старое) или по актору (новое). */
export function routeIfWhenOf(rules: Rules): 'creator_is_assignee' | 'approver_is_actor' | null {
  const rule = rules.postFunctions.find((p) => p.kind === 'route_if');
  return rule && rule.kind === 'route_if' ? rule.when : null;
}

/** Особое правило: цель или выкл (null). Новое правило по умолчанию —
 *  акторное; существующее условие сохраняется при правке цели. */
export function setRouteIf(rules: Rules, toStageId: string | null): Rules {
  const rest = rules.postFunctions.filter((p) => p.kind !== 'route_if');
  const when = routeIfWhenOf(rules) ?? 'approver_is_actor';
  return {
    ...rules,
    postFunctions: toStageId === null ? rest : [...rest, { kind: 'route_if', when, toStageId }],
  };
}

/** Сменить условие пропуска, сохранив цель. */
export function setRouteIfWhen(
  rules: Rules,
  when: 'creator_is_assignee' | 'approver_is_actor',
): Rules {
  const target = routeIfOf(rules);
  if (target === null) return rules;
  return {
    ...rules,
    postFunctions: [
      ...rules.postFunctions.filter((p) => p.kind !== 'route_if'),
      { kind: 'route_if', when, toStageId: target },
    ],
  };
}

/** Цель по умолчанию при включении особого правила: успешный итог не цель. */
export function defaultRouteIfTarget(
  doc: WorkflowDraftDocument,
  transition: WorkflowDraftTransition,
): string | null {
  const success = doc.stages.find(
    (s) => s.systemState === 'closed' && s.outcome === 'success' && s.id !== transition.toStageId,
  );
  return success?.id ?? doc.stages.find((s) => s.id !== transition.toStageId)?.id ?? null;
}
