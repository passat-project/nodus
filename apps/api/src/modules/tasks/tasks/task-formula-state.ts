import type { TaskListItem } from '@nodus/contracts';

import type { CustomFieldRegistry } from '../../custom-fields/ports/custom-field-registry.port.js';
import type { FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/** Гидратация имён/цветов ссылок для эффективных значений (#632, Р9):
 *  значения формулы типа не лежат в строке — refs по сырым данным дали бы
 *  «Запись недоступна» в списках. */
export interface FormulaStateRefs {
  registry: CustomFieldRegistry;
  actor: { id: string; permissions: readonly string[] };
  tx?: TransactionClient;
}

/** Формульное состояние ячеек (#632, Р9): формулы в DTO списков и детали —
 *  значок fx и бейдж ошибки без отдельных запросов на строку. С `refs` —
 *  ещё и имена ссылок по ЭФФЕКТИВНЫМ значениям (после формул типа). */
export async function withFormulaState(
  formulas: FormulaCells,
  items: readonly TaskListItem[],
  refs?: FormulaStateRefs,
): Promise<TaskListItem[]> {
  if (items.length === 0) return [...items];
  const states = await formulas.stateFor(
    'task',
    items.map((item) => item.id),
  );
  const merged = items.map((item) => {
    const state = states.get(item.id);
    if (!state) return item;
    return {
      ...item,
      customFields: { ...item.customFields, ...state.values },
      customFieldFormulas: state.formulas,
    };
  });
  if (!refs) return merged;
  const hydrated = await refs.registry.refsMany(
    merged.map((item) => item.customFields),
    refs.actor,
    refs.tx,
  );
  return hydrated.length === 0
    ? merged
    : merged.map((item) => ({ ...item, customFieldRefs: hydrated }));
}
