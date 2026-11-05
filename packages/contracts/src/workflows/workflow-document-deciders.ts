import { customFieldIdOfKey } from '../custom-fields/custom-field-key.js';
import type { WorkflowDraftDocument, WorkflowProblem } from './workflow-document.schemas.js';

/**
 * Проверки источников решающих (#433): ошибки запрещают публикацию,
 * предупреждения — нет. Чистая функция без I/O (как остальные проверки
 * документа, ADR-0021): факты должностей и типов атрибутов приходят снаружи.
 */

/** Факт должности для проверки: активна и сколько живых держателей. */
export interface WorkflowPositionFact {
  isActive: boolean;
  holders: number;
}

export interface DeciderCheckOptions {
  /** Определения атрибутов области: тип нужен для «поле-Сотрудник(и)». */
  definitions?: readonly { id: string; type: string }[];
  /** id живых атрибутов (для `custom_field_unknown`). */
  activeFieldIds?: ReadonlySet<string>;
  /** id атрибутов, привязанных к типу (для `custom_field_not_in_type`). */
  inTypeFieldIds?: ReadonlySet<string>;
  /** Факты должностей; без них проверки должности пропускаются (старые вызовы). */
  positions?: ReadonlyMap<string, WorkflowPositionFact>;
}

function error(code: WorkflowProblem['code'], transitionId: string): WorkflowProblem {
  return { code, severity: 'error', transitionId };
}

function warning(code: WorkflowProblem['code'], transitionId: string): WorkflowProblem {
  return { code, severity: 'warning', transitionId };
}

/** Гейты и разделы окна, для которых нужны права участника задачи
 *  (`canEdit`/`canLogTime`/`canCheck`). Решающий вне задачи их не получит —
 *  такой маршрут публиковать нельзя (O4 плана #433). */
const RIGHTS_VALIDATORS = new Set([
  'checklist_complete',
  'fields_required',
  'time_logged',
  'result_present',
  'result_files',
]);
const RIGHTS_SECTIONS = new Set(['fields', 'time', 'result', 'result_files']);

export function checkDeciderRules(
  doc: WorkflowDraftDocument,
  opts: DeciderCheckOptions,
  problems: WorkflowProblem[],
): void {
  const definitions = new Map((opts.definitions ?? []).map((d) => [d.id, d.type]));

  for (const t of doc.transitions) {
    const deciders = t.rules.conditions.filter((c) => c.kind === 'decider_in');
    if (deciders.length === 0) continue;

    for (const condition of deciders) {
      const source = condition.source;
      if (source.kind === 'field') {
        const fieldId = customFieldIdOfKey(source.field);
        if (fieldId === null) continue;
        if (opts.activeFieldIds && !opts.activeFieldIds.has(fieldId)) {
          problems.push(error('custom_field_unknown', t.id));
        } else if (opts.inTypeFieldIds && !opts.inTypeFieldIds.has(fieldId)) {
          problems.push(error('custom_field_not_in_type', t.id));
        } else if (definitions.size > 0) {
          const type = definitions.get(fieldId);
          if (type !== 'user' && type !== 'users') {
            problems.push(error('decider_field_not_user', t.id));
          }
        }
      }
      if (source.kind === 'position' && opts.positions) {
        const position = opts.positions.get(source.positionId);
        if (!position || !position.isActive) {
          problems.push(error('decider_position_missing', t.id));
        } else if (position.holders === 0) {
          problems.push(warning('decider_position_empty', t.id));
        }
      }
    }

    // Кнопка, доступная ТОЛЬКО решающим, не должна требовать прав участника:
    // иначе решающий увидит кнопку, но окно вернёт 403 (O4).
    const onlyDeciders = t.rules.conditions.every((c) => c.kind === 'decider_in');
    const sections = t.form?.enabled ? t.form.sections : [];
    const needsParticipantRights =
      t.rules.validators.some((v) => RIGHTS_VALIDATORS.has(v.kind)) ||
      sections.some((s) => RIGHTS_SECTIONS.has(s.kind));
    if (onlyDeciders && needsParticipantRights) {
      problems.push(error('decider_window_needs_rights', t.id));
    }
  }
}
