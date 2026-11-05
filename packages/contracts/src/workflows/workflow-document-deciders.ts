import { customFieldIdOfKey } from '../custom-fields/custom-field-key.js';
import type { WorkflowDraftDocument, WorkflowProblem } from './workflow-document.schemas.js';

/**
 * Проверки источников решающих (#433): ошибки запрещают публикацию,
 * предупреждения — нет. Чистая функция без I/O (как остальные проверки
 * документа, ADR-0021): факты должностей и типов атрибутов приходят снаружи.
 * Удалённость и привязка атрибутов к типу проверяются общим `checkKey`
 * документа — здесь только то, чего он не знает.
 */

/** Факт должности для проверки: вид, активность и число живых держателей. */
export interface WorkflowPositionFact {
  kind?: 'management' | 'legal';
  isActive: boolean;
  holders: number;
}

export interface DeciderCheckOptions {
  /** Определения атрибутов области: тип нужен для «поле-Сотрудник(и)». */
  definitions?: readonly { id: string; type: string }[];
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
        if (definitions.size > 0) {
          const type = definitions.get(fieldId);
          if (type !== 'user' && type !== 'users') {
            problems.push(error('decider_field_not_user', t.id));
          }
        }
      }
      if (source.kind === 'position' && opts.positions) {
        const position = opts.positions.get(source.positionId);
        const kindMismatch = position?.kind !== undefined && position.kind !== source.positionKind;
        if (!position || !position.isActive || kindMismatch) {
          problems.push(error('decider_position_missing', t.id));
        } else if (position.holders === 0) {
          problems.push(warning('decider_position_empty', t.id));
        }
      }
      if (source.kind === 'employees' && source.userIds.length === 0) {
        problems.push(error('decider_source_empty', t.id));
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
