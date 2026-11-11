import { customFieldIdOfKey } from '../custom-fields/custom-field-key.js';
import { isLockableKey } from '../forms/field-lock.js';
import { checkFormDecor } from '../forms/form-layout.js';
import type { WorkflowDraftDocument, WorkflowProblem } from './workflow-document.schemas.js';

/**
 * Окно кнопки в конструкторе (#496, Р8) — часть `checkWorkflowDocument`:
 * пустое оформление раздела «Поля» и замки окна. Проверяется только
 * включённое окно: замки выключенного не действуют (В13), документ их хранит.
 * Без фактов атрибутов (`customFields`) проверяется только годность ключа.
 * Хозяева окна — и переходы, и действия без смены статуса (#740): конструктор
 * у них один, проверки тоже.
 */
export function checkWindowLayoutAndLocks(
  doc: Pick<WorkflowDraftDocument, 'transitions' | 'actions'>,
  customFields?: { active: ReadonlySet<string>; inType?: ReadonlySet<string> },
): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const error = (
    code: WorkflowProblem['code'],
    refs: Partial<Pick<WorkflowProblem, 'transitionId' | 'actionId'>>,
  ): void => {
    problems.push({ code, severity: 'error', ...refs });
  };
  const owners = [
    ...doc.transitions.map((t) => ({ form: t.form, ref: { transitionId: t.id } })),
    ...(doc.actions ?? []).map((a) => ({ form: a.form, ref: { actionId: a.id } })),
  ];
  for (const owner of owners) {
    const form = owner.form;
    if (!form?.enabled) continue;
    for (const section of form.sections) {
      if (section.kind === 'fields' && checkFormDecor(section.fields).length > 0) {
        error('form_decor_empty', owner.ref);
      }
    }
    for (const lock of form.locks ?? []) {
      if (!isLockableKey(lock.key)) {
        error('form_lock_key_invalid', owner.ref);
        continue;
      }
      const fieldId = customFieldIdOfKey(lock.key);
      if (fieldId === null || !customFields) continue;
      if (!customFields.active.has(fieldId)) error('custom_field_unknown', owner.ref);
      else if (customFields.inType && !customFields.inType.has(fieldId)) {
        error('form_lock_field_not_in_type', owner.ref);
      }
    }
  }
  return problems;
}
