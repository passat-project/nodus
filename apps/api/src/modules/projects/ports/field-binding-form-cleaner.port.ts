import type { InjectionToken } from '@nestjs/common';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Write-порт уборки слота формы места при снятии привязки атрибута (#646):
 * слот формы — та же привязка (Р3/Р10 #631), но привязка без слота законна.
 * `syncPlaceBindings` добавляет привязки слотов и снимает только снятые
 * слоты; этот порт снимает слот, когда привязку убрали из диалога атрибута.
 * Таблицы мест принадлежат projects (I3), custom-fields ходит через порт.
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
