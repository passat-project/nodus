import type { InjectionToken } from '@nestjs/common';

/**
 * Порт значений атрибутов на задачах (#431; ревизия #631 — без областей):
 * колонка `tasks.custom_fields` принадлежит модулю tasks (I3), поэтому
 * «сколько карточек заполнено» считает владелец таблицы. Потребитель — окно
 * последствий удаления атрибута (custom-fields).
 */
export const CUSTOM_FIELD_VALUES_READER: InjectionToken = 'CUSTOM_FIELD_VALUES_READER';

export interface CustomFieldValuesReader {
  /** Число задач с ключом атрибута, включая мягко удалённые: счётчик
   *  равен реальному объёму уборки (cleanup чистит и надгробия). */
  countValues(fieldId: string): Promise<number>;
}
