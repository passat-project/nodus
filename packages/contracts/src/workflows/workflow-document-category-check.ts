import type { ProcessCategory } from './process-type.schemas.js';
import { TRANSITION_FORM_SECTION_ORDER } from './transition-form.schemas.js';
import type { WorkflowDraftDocument, WorkflowProblem } from './workflow-document.schemas.js';
import {
  WORKFLOW_POST_FUNCTIONS_BY_CATEGORY,
  WORKFLOW_ROLES_BY_CATEGORY,
  WORKFLOW_VALIDATORS_BY_CATEGORY,
  type WorkflowActorRole,
  type WorkflowPostFunction,
  type WorkflowValidator,
} from './workflow.schemas.js';

/**
 * Словарь категории в документе маршрута (#55, Р6) — часть общей проверки
 * `checkWorkflowDocument` (одна грамматика редактора и сервера, ADR-0021):
 * роль, раздел окна, гейт и пост-действие должны принадлежать категории
 * типа — иначе движок исполнял бы правило, которого адаптер категории не
 * знает (роль письма у задачи, задачный гейт у письма — ложная безопасность).
 * Нумерация: «Присвоить номер» без серии у типа — ошибка публикации;
 * «Регистрация» без «Присвоить номер» — предупреждение (номер не выдастся).
 */

type SectionKind = (typeof TRANSITION_FORM_SECTION_ORDER)[number];

/** Разделы окна по категории: регистрация — только у писем; у писем в #55
 *  есть ещё причина/комментарий (закрыть без регистрации, отмена). */
export const WORKFLOW_SECTIONS_BY_CATEGORY = {
  task: ['fields', 'time', 'result', 'result_files', 'result_messages', 'comment'],
  letter: ['registration', 'comment'],
} as const satisfies Record<ProcessCategory, readonly SectionKind[]>;

export interface CategoryCheckOptions {
  category: ProcessCategory;
  /** У типа настроена серия номеров (`config.numbering`); без факта
   *  проверка нумерации пропускается. Серия писем — из конфига типа (#55);
   *  серия задач — из counter-атрибута `fieldId` (#630, Р5). */
  numberingConfigured?: boolean;
  /** Поля атрибутов, привязанные к типу (task): «Присвоить номер» задач
   *  указывает поле-цель `fieldId` (#630, Р4). Список не передан —
   *  проверка цели пропускается (как `numberingConfigured`). */
  customFieldIds?: readonly string[];
  /** Среди полей типа — counter-поля с настроенным правилом серии (#630):
   *  цель «Присвоить номер» обязана быть таким полем. */
  counterFieldIds?: readonly string[];
}

export function checkCategoryDictionary(
  doc: WorkflowDraftDocument,
  { category, numberingConfigured, customFieldIds, counterFieldIds }: CategoryCheckOptions,
): WorkflowProblem[] {
  const roles: readonly WorkflowActorRole[] = WORKFLOW_ROLES_BY_CATEGORY[category];
  const sections: readonly SectionKind[] = WORKFLOW_SECTIONS_BY_CATEGORY[category];
  const validators: readonly WorkflowValidator['kind'][] =
    WORKFLOW_VALIDATORS_BY_CATEGORY[category];
  const postFunctions: readonly WorkflowPostFunction['kind'][] =
    WORKFLOW_POST_FUNCTIONS_BY_CATEGORY[category];
  const problems: WorkflowProblem[] = [];

  for (const t of doc.transitions) {
    const refs = { transitionId: t.id };
    const foreignRole = t.rules.conditions.some(
      (c) => c.kind === 'role_in' && c.roles.some((role) => !roles.includes(role)),
    );
    if (foreignRole) problems.push({ code: 'role_not_in_category', severity: 'error', ...refs });

    // Решающие (#433) поддерживаются только задачами: у писем другая модель
    // акторов (регистратор/адресат). Ошибка публикации, не молчаливый игнор.
    if (category !== 'task' && t.rules.conditions.some((c) => c.kind === 'decider_in')) {
      problems.push({ code: 'decider_not_in_category', severity: 'error', ...refs });
    }

    const windowSections = t.form?.enabled ? t.form.sections : [];
    if (windowSections.some((s) => !sections.includes(s.kind))) {
      problems.push({ code: 'section_not_in_category', severity: 'error', ...refs });
    }
    if (t.rules.validators.some((v) => !validators.includes(v.kind))) {
      problems.push({ code: 'gate_not_in_category', severity: 'error', ...refs });
    }
    if (t.rules.postFunctions.some((pf) => !postFunctions.includes(pf.kind))) {
      problems.push({ code: 'post_function_not_in_category', severity: 'error', ...refs });
    }

    const assignsNumber = t.rules.postFunctions.some((pf) => pf.kind === 'assign_number');
    // Письмо: серия из конфига типа (#55). Задача: номер в counter-поле —
    // конфиг типа не при чём (numbering_not_configured не проверяется).
    if (category === 'letter' && assignsNumber && numberingConfigured === false) {
      problems.push({ code: 'numbering_not_configured', severity: 'error', ...refs });
    }
    if (category === 'task' && customFieldIds !== undefined) {
      for (const pf of t.rules.postFunctions) {
        if (pf.kind !== 'assign_number') continue;
        if (!pf.fieldId || !customFieldIds.includes(pf.fieldId)) {
          // Нет поля-цели (не выбрано) или поле не у типа.
          problems.push({ code: 'number_field_not_in_type', severity: 'error', ...refs });
        } else if (!counterFieldIds?.includes(pf.fieldId)) {
          // Поле у типа есть, но это не counter-атрибут с правилом серии.
          problems.push({ code: 'number_field_not_counter', severity: 'error', ...refs });
        }
      }
    }
    if (windowSections.some((s) => s.kind === 'registration') && !assignsNumber) {
      problems.push({ code: 'registration_without_number', severity: 'warning', ...refs });
    }
  }
  return problems;
}
