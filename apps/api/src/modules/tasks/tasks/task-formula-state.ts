import type { TaskListItem } from '@nodus/contracts';

import type { FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';

/** Формульное состояние ячеек (#632, Р9): формулы в DTO списков и детали —
 *  значок fx и бейдж ошибки без отдельных запросов на строку. */
export async function withFormulaState(
  formulas: FormulaCells,
  items: readonly TaskListItem[],
): Promise<TaskListItem[]> {
  if (items.length === 0) return [...items];
  const states = await formulas.stateFor(
    'task',
    items.map((item) => item.id),
  );
  return items.map((item) => {
    const state = states.get(item.id);
    if (!state) return item;
    return {
      ...item,
      customFields: { ...item.customFields, ...state.values },
      customFieldFormulas: state.formulas,
    };
  });
}
