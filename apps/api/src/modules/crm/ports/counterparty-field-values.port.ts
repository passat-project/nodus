import type { InjectionToken } from '@nestjs/common';

/**
 * Read-порт «значения атрибутов у контрагентов» (#646): колонка
 * `counterparties.custom_fields` принадлежит модулю crm (I3), модуль
 * атрибутов считает её только через порт владельца данных (ADR-0012).
 * Значения пишет будущий CRM-контур (Н2), но миграция #631 уже переписывает
 * их ключи — usage-агрегат обязан видеть реальный урон при удалении.
 */
export const COUNTERPARTY_FIELD_VALUES_READER: InjectionToken = 'COUNTERPARTY_FIELD_VALUES_READER';

export interface CounterpartyFieldValuesReader {
  /** Число контрагентов (включая архивных), у которых ключ атрибута заполнен. */
  countValues(fieldId: string): Promise<number>;
}
