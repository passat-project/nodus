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
  typeIdOrIds?: string | readonly string[],
): Promise<WorkflowCustomFieldFacts> {
  // active — весь реестр (атрибут существует), inType — привязанные к типу
  // процесса. Иначе `custom_field_not_in_type` недостижим: непривязанный
  // существующий атрибут получал бы `custom_field_unknown` (#646).
  const all = await registry.definitions({}, tx);
  const typeIds = typeof typeIdOrIds === 'string' ? [typeIdOrIds] : (typeIdOrIds ?? []);
  // Маршрут с несколькими типами: слот формы создания должен быть привязан
  // к КАЖДОМУ типу, который идёт по маршруту (пересечение), иначе у одного
  // из типов поле невидимо (#646).
  const perType = await Promise.all(
    typeIds.map((typeId) =>
      registry.definitions({ target: { kind: 'process_type', id: typeId } }, tx),
    ),
  );
  let inType: Set<string> | null = null;
  if (perType.length > 0) {
    inType = new Set(perType[0]!.map((definition) => definition.id));
    for (const definitions of perType.slice(1)) {
      const bound = new Set(definitions.map((definition) => definition.id));
      inType = new Set([...inType].filter((id) => bound.has(id)));
    }
  }
  return {
    active: new Set(all.map((definition) => definition.id)),
    ...(inType ? { inType } : {}),
  };
}
