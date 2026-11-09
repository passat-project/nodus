import { Module, forwardRef } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { ROLE_MEMBERSHIP_READER } from '../../core/ports/role-membership.port.js';
import { CustomFieldsPortsModule } from '../custom-fields/custom-fields-ports.module.js';
import { RoleMembershipProvider } from '../../core/ports/role-membership.provider.js';
import { NumberSeriesService } from './numbering/number-series.service.js';
import { NumberSeriesStoreProvider } from './numbering/number-series.provider.js';
import { NUMBER_SERIES_STORE } from './ports/number-series.port.js';
import { WorkflowEntityRegistry } from './workflow/engine/entity-adapter.registry.js';
import { TransitionRecordsRepository } from './workflow/engine/transition-records.repository.js';
import { WorkflowEngine } from './workflow/engine/workflow-engine.js';
import { WorkflowRepository } from './workflow/workflow.repository.js';
import { ProcessCatalogReaderProvider } from './ports/process-catalog-reader.provider.js';
import { PROCESS_CATALOG_READER } from './ports/process-catalog-reader.port.js';
import { WorkflowFieldUsageProvider } from './ports/workflow-field-usage.provider.js';
import { WORKFLOW_FIELD_USAGE_READER } from './ports/workflow-field-usage.port.js';
import { ProcessTypeFormCleanerProvider } from './ports/process-type-form-cleaner.provider.js';
import { PROCESS_TYPE_FORM_CLEANER } from './ports/process-type-form-cleaner.port.js';
import { WORKFLOW_ENGINE } from './ports/workflow-engine.port.js';
import { WorkflowRulesReaderProvider } from './ports/workflow-rules-reader.provider.js';
import { WORKFLOW_RULES_READER } from './ports/workflow-rules-reader.port.js';
import { WorkflowPressReaderProvider } from './ports/workflow-press-reader.provider.js';
import { WORKFLOW_PRESS_READER } from './ports/workflow-press-reader.port.js';
import { ProcessTypesRepository } from './types/process-types.repository.js';

/**
 * Порты «Процессов» для модулей-владельцев сущностей (ADR-0012, ADR-0024):
 * `WORKFLOW_ENGINE` (доступные переходы и выполнение в транзакции
 * вызывающего) и `PROCESS_CATALOG_READER` (гидратация типов и стадий,
 * разрешение типа в маршрут, каталог стадий). Доменные сервисы редактора и
 * публикации наружу не экспортируются. Реестр адаптеров и репозитории
 * экспортируются для СОБСТВЕННЫХ сервисов WorkflowsModule (редактор, типы,
 * фоновый перенос), не для чужих модулей: чужой модуль берёт только токены
 * портов.
 *
 * #432: доступ к типу считается здесь же — каталог обязан знать роли
 * смотрящего (`ROLE_MEMBERSHIP_READER`, ADR-0034), иначе задачи создавались
 * бы по невидимым типам. Биндинг токена — в модуле-потребителе (ADR-0012).
 */
@Module({
  // DiscoveryService — скан провайдеров со `static readonly workflowCategory`
  // при bootstrap (тот же приём, что eventType у обработчиков событий).
  // NUMBER_ISSUE движка выдачи (#630) живёт в custom-fields; цикл портов
  // разорван forwardRef (оба модуля — тонкие адаптеры, не домены).
  imports: [DiscoveryModule, forwardRef(() => CustomFieldsPortsModule)],
  providers: [
    RoleMembershipProvider,
    { provide: ROLE_MEMBERSHIP_READER, useClass: RoleMembershipProvider },
    WorkflowRepository,
    ProcessTypesRepository,
    WorkflowEntityRegistry,
    TransitionRecordsRepository,
    NumberSeriesService,
    NumberSeriesStoreProvider,
    { provide: NUMBER_SERIES_STORE, useExisting: NumberSeriesStoreProvider },
    WorkflowEngine,
    ProcessCatalogReaderProvider,
    { provide: WORKFLOW_ENGINE, useExisting: WorkflowEngine },
    { provide: PROCESS_CATALOG_READER, useExisting: ProcessCatalogReaderProvider },
    WorkflowFieldUsageProvider,
    { provide: WORKFLOW_FIELD_USAGE_READER, useExisting: WorkflowFieldUsageProvider },
    ProcessTypeFormCleanerProvider,
    { provide: PROCESS_TYPE_FORM_CLEANER, useExisting: ProcessTypeFormCleanerProvider },
    WorkflowRulesReaderProvider,
    { provide: WORKFLOW_RULES_READER, useExisting: WorkflowRulesReaderProvider },
    WorkflowPressReaderProvider,
    { provide: WORKFLOW_PRESS_READER, useExisting: WorkflowPressReaderProvider },
  ],
  exports: [
    WORKFLOW_ENGINE,
    PROCESS_CATALOG_READER,
    WORKFLOW_FIELD_USAGE_READER,
    WORKFLOW_RULES_READER,
    WORKFLOW_PRESS_READER,
    PROCESS_TYPE_FORM_CLEANER,
    ROLE_MEMBERSHIP_READER,
    NUMBER_SERIES_STORE,
    WorkflowEntityRegistry,
    WorkflowRepository,
    ProcessTypesRepository,
  ],
})
export class WorkflowsPortsModule {}
