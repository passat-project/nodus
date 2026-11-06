import type { CustomFieldRef, CustomFieldValues } from '@nodus/contracts';

import type { CustomFieldRegistry } from '../../custom-fields/ports/custom-field-registry.port.js';
import type {
  FormulaCells,
  FormulaHostState,
} from '../../custom-fields/ports/formula-cells.port.js';
import type { ProjectActor } from '../../projects/ports/project-reader.port.js';
import type { LetterListRow } from './letter-row.js';

/** Атрибуты строки списка писем (#632, Р9): значения (формулы типа наложены
 *  на чтении), ссылки и формульное состояние — колонки без N+1. */
export interface LetterListAttributes {
  refs: readonly CustomFieldRef[];
  state?: FormulaHostState;
}

/**
 * Батч атрибутов страницы списка (#632, Р9): формульное состояние всех писем
 * страницы одним запросом, ссылки — одним набором на страницу. Ссылки
 * собираются по ЭФФЕКТИВНЫМ значениям (формулы типа наложены): иначе
 * ref-значение формулы не получило бы имя в колонке списка.
 */
export async function letterListAttributes(
  registry: CustomFieldRegistry,
  formulas: FormulaCells,
  rows: readonly LetterListRow[],
  actor: ProjectActor,
): Promise<Map<string, LetterListAttributes>> {
  const states = await formulas.stateFor(
    'letter',
    rows.map((row) => row.id),
  );
  const refs = await registry.refsMany(
    rows.map(
      (row) =>
        ({
          ...((row.customFields ?? {}) as CustomFieldValues),
          ...(states.get(row.id)?.values ?? {}),
        }) as CustomFieldValues,
    ),
    actor,
  );
  const result = new Map<string, LetterListAttributes>();
  for (const row of rows) {
    const state = states.get(row.id);
    result.set(row.id, { refs, ...(state ? { state } : {}) });
  }
  return result;
}
