import { Module } from '@nestjs/common';

import { CorrespondencePortsModule } from '../correspondence/correspondence-ports.module.js';
import { ContactsController } from './contacts/contacts.controller.js';
import { ContactsRepository } from './contacts/contacts.repository.js';
import { ContactsService } from './contacts/contacts.service.js';
import { CounterpartiesController } from './counterparties/counterparties.controller.js';
import { CounterpartiesQueryService } from './counterparties/counterparties-query.service.js';
import { CounterpartiesRepository } from './counterparties/counterparties.repository.js';
import { CounterpartiesService } from './counterparties/counterparties.service.js';
import { CounterpartyUsagesRepository } from './counterparties/counterparty-usages.repository.js';
import {
  LetterDeletedUsageHandler,
  LetterRegisteredUsageHandler,
  LetterUpdatedUsageHandler,
} from './events/letter-usage.handler.js';
import {
  ProjectCreatedUsageHandler,
  ProjectUpdatedUsageHandler,
} from './events/project-usage.handler.js';

/**
 * Модуль crm (#460, ADR-0033): master-данные внешних организаций —
 * контрагенты и контактные лица. За фичефлагом `crm` (I10): выключенный
 * модуль отвечает 404 как несуществующий. Чужим модулям доступен только
 * read-порт `COUNTERPARTY_READER` (CrmPortsModule, ADR-0012) — доменные
 * сервисы и репозитории не экспортируются (I3/I6).
 */
@Module({
  // Видимость писем (#461, Р4): счётчик «Писем» карточки — по тому же
  // правилу, что реестр (read-порт владельца данных, ADR-0012).
  imports: [CorrespondencePortsModule],
  controllers: [CounterpartiesController, ContactsController],
  providers: [
    CounterpartiesRepository,
    CounterpartyUsagesRepository,
    ContactsRepository,
    CounterpartiesQueryService,
    CounterpartiesService,
    ContactsService,
    // Проекция «письма контрагента» (#55, B6): события корреспонденции.
    LetterRegisteredUsageHandler,
    LetterUpdatedUsageHandler,
    LetterDeletedUsageHandler,
    ProjectCreatedUsageHandler,
    ProjectUpdatedUsageHandler,
  ],
})
export class CrmModule {}
