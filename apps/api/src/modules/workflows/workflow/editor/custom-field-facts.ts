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
  const definitions = await registry.definitions(
    typeId ? { target: { kind: 'process_type', id: typeId } } : {},
    tx,
  );
  return {
    active: new Set(definitions.map((definition) => definition.id)),
    ...(typeId
      ? {
          inType: new Set(definitions.map((definition) => definition.id)),
        }
      : {}),
  };
}
