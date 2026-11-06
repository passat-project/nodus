import type { WorkflowCustomFieldFacts } from '@nodus/contracts';

import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import type { CustomFieldRegistry } from '../../../custom-fields/ports/custom-field-registry.port.js';

/**
 * Факты атрибутов для проверки документа маршрута (#431, Р7; ревизия #631 —
 * без областей и глобального hidden): активные id и привязанные к типу
 * процесса. Категория маршрута значения не имеет — атрибуты общие.
 * Вынесено из сервиса публикации: правило «что считается существующим
 * атрибутом» живёт в одном месте.
 */
export async function customFieldFactsOf(
  registry: CustomFieldRegistry,
  tx: TransactionClient,
  typeId?: string,
): Promise<WorkflowCustomFieldFacts> {
  // active — весь реестр (атрибут существует), inType — только привязанные к
  // типу процесса. Иначе `custom_field_not_in_type` недостижим: непривязанный
  // существующий атрибут получал бы `custom_field_unknown` (#646).
  const all = await registry.definitions({}, tx);
  const inType = typeId
    ? await registry.definitions({ target: { kind: 'process_type', id: typeId } }, tx)
    : null;
  return {
    active: new Set(all.map((definition) => definition.id)),
    ...(inType ? { inType: new Set(inType.map((definition) => definition.id)) } : {}),
  };
}
