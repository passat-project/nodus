import { customFieldIdOfKey } from '../custom-fields/custom-field-key.js';
import { isLockableKey } from '../forms/field-lock.js';
import { checkFormDecor } from '../forms/form-layout.js';
import type { WorkflowDraftDocument, WorkflowProblem } from './workflow-document.schemas.js';

/**
 * Окно кнопки в конструкторе (#496, Р8) — часть `checkWorkflowDocument`:
 * пустое оформление раздела «Поля» и замки окна. Проверяется только
 * включённое окно: замки выключенного не действуют (В13), документ их хранит.
 * Без фактов атрибутов (`customFields`) проверяется только годность ключа.
 */
export function checkWindowLayoutAndLocks(
  doc: Pick<WorkflowDraftDocument, 'transitions'>,
  customFields?: { active: ReadonlySet<string>; inType?: ReadonlySet<string> },
): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const error = (code: WorkflowProblem['code'], transitionId: string): void => {
    problems.push({ code, severity: 'error', transitionId });
  };
  for (const t of doc.transitions) {
    if (!t.form?.enabled) continue;
    for (const section of t.form.sections) {
      if (section.kind === 'fields' && checkFormDecor(section.fields).length > 0) {
        error('form_decor_empty', t.id);
      }
    }
    for (const lock of t.form.locks ?? []) {
      if (!isLockableKey(lock.key)) {
        error('form_lock_key_invalid', t.id);
        continue;
      }
      const fieldId = customFieldIdOfKey(lock.key);
      if (fieldId === null || !customFields) continue;
      if (!customFields.active.has(fieldId)) error('custom_field_unknown', t.id);
      else if (customFields.inType && !customFields.inType.has(fieldId)) {
        error('form_lock_field_not_in_type', t.id);
      }
    }
  }
  return problems;
}
