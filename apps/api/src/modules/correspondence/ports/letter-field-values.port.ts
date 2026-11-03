import type { InjectionToken } from '@nestjs/common';
import type { CustomFieldScope } from '@nodus/contracts';

/**
 * Порт значений атрибутов писем (#575): колонка `letters.custom_fields`
 * принадлежит модулю correspondence (I3), поэтому «сколько писем заполнено»
 * считает владелец таблицы. Потребитель — реестр атрибутов (custom-fields)
 * для окна удаления определения.
 */
export const LETTER_FIELD_VALUES_READER: InjectionToken = 'LETTER_FIELD_VALUES_READER';

export interface LetterFieldValuesReader {
  /** Число живых писем, у которых ключ атрибута заполнен. Область — всегда
   *  `letter`; параметр нужен для единой сигнатуры с читателем задач. */
  countValues(scope: CustomFieldScope, fieldId: string): Promise<number>;
}
