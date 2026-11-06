import { Injectable } from '@nestjs/common';

import { CounterpartiesRepository } from '../counterparties/counterparties.repository.js';
import type { CounterpartyFieldValuesReader } from './counterparty-field-values.port.js';

/** Реализация read-порта значений атрибутов контрагентов (#646): таблицы
 *  crm читаются собственным репозиторием модуля. */
@Injectable()
export class CounterpartyFieldValuesProvider implements CounterpartyFieldValuesReader {
  constructor(private readonly counterparties: CounterpartiesRepository) {}

  countValues(fieldId: string): Promise<number> {
    return this.counterparties.countCustomFieldValues(fieldId);
  }
}
