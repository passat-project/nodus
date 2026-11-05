import type { InjectionToken } from '@nestjs/common';

/**
 * Порт значений атрибутов писем (#575; ревизия #631 — без областей):
 * колонка `letters.custom_fields` принадлежит модулю correspondence (I3),
 * «сколько писем заполнено» считает владелец таблицы. Потребитель — окно
 * последствий удаления атрибута (custom-fields).
 */
export const LETTER_FIELD_VALUES_READER: InjectionToken = 'LETTER_FIELD_VALUES_READER';

export interface LetterFieldValuesReader {
  /** Число живых писем, у которых ключ атрибута заполнен. */
  countValues(fieldId: string): Promise<number>;
}
