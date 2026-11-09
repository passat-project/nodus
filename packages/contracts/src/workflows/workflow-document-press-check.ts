import { customFieldIdOfKey } from '../custom-fields/custom-field-key.js';
import type { CustomFieldDefinition } from '../custom-fields/custom-field.schemas.js';
import type { ProcessCategory } from './process-type.schemas.js';
import { WORKFLOW_ROLES_BY_CATEGORY } from './workflow-roles.js';
import type { WorkflowPositionFact } from './workflow-document-deciders.js';
import type {
  WorkflowDraftTransition,
  WorkflowProblem,
} from './workflow-document.schemas.js';

export interface PressCheckOptions {
  category?: ProcessCategory;
  customFields?: { active: ReadonlySet<string>; inType?: ReadonlySet<string> };
  definitions?: readonly Pick<CustomFieldDefinition, 'id' | 'type'>[];
  positions?: ReadonlyMap<string, WorkflowPositionFact>;
}

function error(
  code: WorkflowProblem['code'],
  transitionId: string,
): WorkflowProblem {
  return { code, severity: 'error', transitionId };
}

/**
 * Проверка настройки «Кнопку жмут несколько» (#434) — до публикации, чтобы
 * несохранённая или неисполнимая настройка не давала «0 участников» в проде:
 * только задачи, непустые источники, роли/поля/должности своей категории,
 * обычная кнопка-действие из конкретного статуса и одна коллективная кнопка
 * на статус (карточка показывает один раунд).
 */
export function checkPressRules(
  transitions: readonly WorkflowDraftTransition[],
  opts: PressCheckOptions,
): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const byStage = new Map<string, number>();
  for (const transition of transitions) {
    const press = transition.press;
    if (!press) continue;
    const ref = transition.id;
    if (opts.category && opts.category !== 'task') {
      problems.push(error('press_not_in_category', ref));
    }
    if (press.sources.length === 0) problems.push(error('press_source_empty', ref));
    if (
      transition.fromStageId === null ||
      transition.fromStageId === transition.toStageId ||
      transition.display === 'menu' ||
      transition.intent !== 'action'
    ) {
      problems.push(error('press_button_invalid', ref));
    }
    const stageKey = transition.fromStageId ?? '*';
    byStage.set(stageKey, (byStage.get(stageKey) ?? 0) + 1);

    for (const source of press.sources) {
      if (source.kind === 'role' && opts.category) {
        const allowed = new Set(WORKFLOW_ROLES_BY_CATEGORY[opts.category]);
        if (source.roles.some((role) => !allowed.has(role))) {
          problems.push(error('press_role_not_in_category', ref));
        }
      }
      if (source.kind === 'letter_recipients' && opts.category === 'task') {
        problems.push(error('press_source_invalid', ref));
      }
      if (source.kind === 'field') {
        const id = customFieldIdOfKey(source.field);
        if (id === null) {
          problems.push(error('press_field_not_user', ref));
        } else {
          const definition = opts.definitions?.find((item) => item.id === id);
          if (definition && definition.type !== 'user' && definition.type !== 'users') {
            problems.push(error('press_field_not_user', ref));
          }
          if (opts.customFields) {
            if (!opts.customFields.active.has(id)) {
              problems.push(error('press_field_not_user', ref));
            } else if (opts.customFields.inType && !opts.customFields.inType.has(id)) {
              problems.push(error('press_field_not_user', ref));
            }
          }
        }
      }
      if (source.kind === 'position') {
        const fact = opts.positions?.get(source.positionId);
        if (!fact) problems.push(error('press_position_missing', ref));
        else if (fact.holders === 0) problems.push(error('press_position_empty', ref));
      }
    }
  }
  const seen = new Set<string>();
  for (const [stage, count] of byStage) {
    if (count <= 1) continue;
    for (const transition of transitions) {
      if (!transition.press || (transition.fromStageId ?? '*') !== stage) continue;
      if (seen.has(transition.id)) continue;
      seen.add(transition.id);
      problems.push(error('press_multiple_per_stage', transition.id));
    }
  }
  return problems;
}
