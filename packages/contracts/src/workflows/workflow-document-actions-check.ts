import type { ProcessCategory } from './process-type.schemas.js';
import type { WorkflowDraftAction, WorkflowProblem } from './workflow-document.schemas.js';

/** Действия — кнопки без смены статуса (#633): лимит ниже переходов. */
export const MAX_ACTIONS = 40;

function error(
  code: WorkflowProblem['code'],
  refs: Pick<WorkflowProblem, 'actionId'> = {},
): WorkflowProblem {
  return { code, severity: 'error', ...refs };
}

function warning(
  code: WorkflowProblem['code'],
  refs: Pick<WorkflowProblem, 'actionId'> = {},
): WorkflowProblem {
  return { code, severity: 'warning', ...refs };
}

/**
 * Проверки действий маршрута (#633). Вынесено из `workflow-document-check`
 * ради лимита размера файла (I5) и потому что правила самостоятельны:
 * self_loop/дубли целей к действиям не относятся — они не меняют статус.
 */
export function checkActionProblems(
  actions: readonly WorkflowDraftAction[],
  category?: ProcessCategory,
  /** Стадии документа: действие со ссылкой на чужой/неизвестный статус —
   *  ошибка (кросс-маршрутная ссылка не должна дойти до БД). */
  stageIds?: ReadonlySet<string>,
): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  if (actions.length > MAX_ACTIONS) problems.push(error('too_many_actions'));

  const seen = new Set<string>();
  const primaries = new Map<string, number>();
  for (const a of actions) {
    if (a.name.trim().length === 0) problems.push(error('empty_name', { actionId: a.id }));
    if (a.stageId !== null && stageIds !== undefined && !stageIds.has(a.stageId)) {
      problems.push(error('action_stage_unknown', { actionId: a.id }));
    }
    if (a.display === 'primary') {
      const key = a.stageId ?? '*';
      const count = (primaries.get(key) ?? 0) + 1;
      primaries.set(key, count);
      if (count > 1) problems.push(error('multiple_primary', { actionId: a.id }));
    }

    const name = a.name.trim().toLowerCase();
    if (name.length > 0) {
      const key = `${a.stageId ?? '*'}→${name}`;
      if (seen.has(key)) problems.push(error('action_duplicate_name', { actionId: a.id }));
      seen.add(key);
    }

    // Ответ владельца 10.11: пустое действие публиковать нельзя — либо окно,
    // либо хотя бы один шаг.
    if (!a.form.enabled && a.steps.length === 0) {
      problems.push(error('action_without_form_and_steps', { actionId: a.id }));
    }

    if (a.rules.conditions.length === 0) {
      problems.push(error('no_roles', { actionId: a.id }));
    } else if (category !== 'letter' && a.rules.conditions.every((c) => c.kind === 'permission')) {
      // Тот же смысл, что у кнопки-перехода (#430): держателем в «Мои
      // действия» станет ответственный — предупреждаем, не блокируем.
      problems.push(warning('action_without_visibility', { actionId: a.id }));
    }
  }

  return problems;
}
