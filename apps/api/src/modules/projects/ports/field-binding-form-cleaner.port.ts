import type { InjectionToken } from '@nestjs/common';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Write-порт уборки слота формы места при снятии привязки атрибута (#646):
 * инвариант «слот формы места И ЕСТЬ привязка» (Р3/Р10 #631) держится в
 * обе стороны — `syncPlaceBindings` пишет слоты из формы, а этот порт
 * снимает слот, когда привязку убрали из диалога атрибута. Таблицы мест
 * принадлежат projects (I3), custom-fields ходит только через порт.
 */
export const FIELD_BINDING_FORM_CLEANER: InjectionToken = 'FIELD_BINDING_FORM_CLEANER';

export interface FieldBindingFormCleaner {
  /** Убрать слот атрибута из формы места; идемпотентно. */
  removeFieldFromForm(
    target: { kind: 'project_type' | 'node_kind'; id: string },
    fieldId: string,
    actorId: string | null,
    tx: TransactionClient,
  ): Promise<void>;
}
