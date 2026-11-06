import { Module } from '@nestjs/common';

import { CounterpartiesRepository } from './counterparties/counterparties.repository.js';
import { ContactsRepository } from './contacts/contacts.repository.js';
import { CounterpartyFieldValuesProvider } from './ports/counterparty-field-values.provider.js';
import { COUNTERPARTY_FIELD_VALUES_READER } from './ports/counterparty-field-values.port.js';
import { CounterpartyReaderProvider } from './ports/counterparty-reader.provider.js';
import { COUNTERPARTY_READER } from './ports/counterparty-reader.port.js';

/**
 * Порты чтения CRM (ADR-0012): тонкий модуль экспорта read-портов чужим
 * модулям-потребителям (#55 — корреспондент и подписант письма, #52 —
 * заказчик проекта, #646 — значения атрибутов контрагентов). Единственная
 * допустимая форма межмодульного импорта; доменные сервисы и репозитории
 * наружу не экспортируются.
 */
@Module({
  providers: [
    CounterpartiesRepository,
    ContactsRepository,
    CounterpartyReaderProvider,
    { provide: COUNTERPARTY_READER, useExisting: CounterpartyReaderProvider },
    CounterpartyFieldValuesProvider,
    { provide: COUNTERPARTY_FIELD_VALUES_READER, useExisting: CounterpartyFieldValuesProvider },
  ],
  exports: [COUNTERPARTY_READER, COUNTERPARTY_FIELD_VALUES_READER],
})
export class CrmPortsModule {}
