import { ErrorCode, type ProjectTypeForm } from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import type { CustomFieldRegistry } from '../custom-fields/ports/custom-field-registry.port.js';

/** Слоты формы типа — существующие атрибуты записей (Р10 #631): глобальные
 *  переменные привязок не имеют. Ошибка — 422 PROJECT_TYPE_FORM_INVALID. */
export async function assertProjectTypeForm(
  registry: CustomFieldRegistry,
  tx: TransactionClient,
  form: ProjectTypeForm,
): Promise<void> {
  const definitions = await registry.definitions({}, tx);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const issues: { fieldId: string; reason: 'unknown_field' | 'not_bindable' }[] = [];
  for (const slot of form.fields) {
    const definition = byId.get(slot.fieldId);
    if (!definition) issues.push({ fieldId: slot.fieldId, reason: 'unknown_field' });
    else if (definition.isCompany) {
      issues.push({ fieldId: slot.fieldId, reason: 'not_bindable' });
    }
  }
  if (issues.length > 0) {
    throw new DomainException(ErrorCode.PROJECT_TYPE_FORM_INVALID, 'Project type form is invalid', {
      fieldIds: issues,
      reason: issues[0]!.reason,
    });
  }
}

/** Слот И ЕСТЬ привязка (Р3/Р10): запись формы типа синхронизирует
 *  `field_bindings` — добавленный слот привязывает, убранный снимает. */
export function syncProjectTypeForm(
  registry: CustomFieldRegistry,
  tx: TransactionClient,
  id: string,
  form: ProjectTypeForm,
): Promise<void> {
  return registry.syncPlaceBindings(
    { kind: 'project_type', id },
    form.fields.map((slot) => slot.fieldId),
    tx,
  );
}
