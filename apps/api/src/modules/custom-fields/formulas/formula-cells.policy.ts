import type { FormulaCellError } from '@nodus/contracts';

import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';

/**
 * Ядовитая ячейка (#632, аудит 3): формула сохраняется только там, где
 * значение вообще может жить. Правило намеренно **fail-open**: отклоняем
 * лишь доказанные случаи, иначе одна ошибка в привязках снова начнёт
 * отклонять валидные формулы (регрессия владельца).
 *
 * - `isCompany` — глобальная переменная: у неё нет места в записи;
 * - у атрибута есть привязки, и ни одна не совпадает с местом хоста —
 *   значение физически некуда записать;
 * - привязок нет вовсе — судить нельзя, разрешаем (атрибут могут привязать
 *   позже; блокировка тут уже ломала сохранение).
 */
export function formulaPlaceRejection(
  definition: Pick<FieldDefinitionRow, 'isCompany' | 'bindings'>,
  placeId: string | null | undefined,
): FormulaCellError | null {
  if (definition.isCompany) {
    return {
      code: 'attribute_unavailable',
      message: 'global attribute cannot hold a cell formula',
    };
  }
  if (!placeId) return null;
  // Fail-open: строки без загруженных привязок (частичные выборки/тесты) не
  // дают права судить, есть ли у атрибута место.
  const bindings = definition.bindings ?? [];
  if (bindings.length === 0) return null;
  if (bindings.some((binding) => binding.targetId === placeId)) return null;
  return {
    code: 'attribute_unavailable',
    message: 'attribute is not available in this host type',
  };
}
