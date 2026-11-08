import { Module, forwardRef } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { ORG_STRUCTURE_READER } from '../../core/ports/org-structure.port.js';
import { OrgStructureProvider } from '../../core/ports/org-structure.provider.js';
import { USER_PROFILE_READER } from '../../core/ports/user-profile.port.js';
import { UserProfileProvider } from '../../core/ports/user-profile.provider.js';
import { ProjectsPortsModule } from '../projects/projects-ports.module.js';
import { CrmPortsModule } from '../crm/crm-ports.module.js';
import { CorrespondencePortsModule } from '../correspondence/correspondence-ports.module.js';
import { DictionariesPortsModule } from '../dictionaries/dictionaries-ports.module.js';
import { TasksPortsModule } from '../tasks/tasks-ports.module.js';
import { WorkflowsPortsModule } from '../workflows/workflows-ports.module.js';
import { CounterSummaryService } from './numbering/counter-summary.provider.js';
import { NumberHostRegistry } from './numbering/number-host.registry.js';
import { NumberIssueService } from './numbering/number-issue.service.js';
import { NumberRefService } from './numbering/number-ref.service.js';
import { NUMBER_HOST_REGISTRY } from './ports/number-host.port.js';
import { NUMBER_ISSUE } from './ports/number-issue.port.js';
import { CustomFieldRegistryProvider } from './ports/custom-field-registry.provider.js';
import { CUSTOM_FIELD_REGISTRY } from './ports/custom-field-registry.port.js';
import { FormulaEngineProvider } from './ports/formula-engine.provider.js';
import { FORMULA_ENGINE } from './ports/formula-engine.port.js';
import { FORMULA_CELLS } from './ports/formula-cells.port.js';
import { RECORD_VALUES_READER } from './ports/record-values.port.js';
import { RecordValuesProvider } from './ports/record-values.provider.js';
import { DefinitionMapper } from './definitions/definition.mapper.js';
import { DefinitionsRepository } from './definitions/definitions.repository.js';
import { CustomFieldDefaults } from './values/defaults.js';
import { CustomFieldRefsHydrator } from './values/refs-hydrator.js';
import { CustomFieldValueValidator } from './values/value-validator.js';
import { FormulaCellsRepository } from './formulas/formula-cells.repository.js';
import { FormulaCellsService } from './formulas/formula-cells.service.js';
import { FormulaContextService } from './formulas/formula-context.service.js';
import { FormulaMetaService } from './formulas/formula-meta.service.js';
import { FormulaValuesService } from './formulas/formula-values.service.js';

/**
 * Порты реестра атрибутов (#431, ADR-0029): `CUSTOM_FIELD_REGISTRY` —
 * единственная точка динамической валидации значений и умолчаний для
 * модулей-владельцев сущностей (tasks сейчас; письма/проекты/контрагенты —
 * #55/#52/Н2). Тонкий модуль без HTTP: чужие модули импортируют только
 * токен, доменные сервисы реестра наружу не экспортируются (ADR-0012).
 *
 * Источники ссылок — порты владельцев данных (I3): профили сотрудников,
 * оргструктура, справочники, контрагенты, проекты, задачи, письма, папки
 * (Р3/Р5 #631). Встречный импорт tasks (decider-Recipients) — ESM-цикл
 * обоих модулей разорван forwardRef'ами; реестр там разрешается лениво
 * через ModuleRef (конструкторского цикла инстанцирования нет).
 */
@Module({
  imports: [
    DiscoveryModule,
    DictionariesPortsModule,
    CrmPortsModule,
    ProjectsPortsModule,
    forwardRef(() => TasksPortsModule),
    CorrespondencePortsModule,
    forwardRef(() => WorkflowsPortsModule),
  ],
  providers: [
    UserProfileProvider,
    { provide: USER_PROFILE_READER, useClass: UserProfileProvider },
    OrgStructureProvider,
    { provide: ORG_STRUCTURE_READER, useClass: OrgStructureProvider },
    DefinitionsRepository,
    DefinitionMapper,
    CustomFieldValueValidator,
    CustomFieldDefaults,
    CustomFieldRefsHydrator,
    CustomFieldRegistryProvider,
    { provide: CUSTOM_FIELD_REGISTRY, useExisting: CustomFieldRegistryProvider },
    // Счётчики (#630): реестр носителей, движок выдачи, сводки DTO.
    NumberHostRegistry,
    { provide: NUMBER_HOST_REGISTRY, useExisting: NumberHostRegistry },
    NumberRefService,
    NumberIssueService,
    { provide: NUMBER_ISSUE, useExisting: NumberIssueService },
    CounterSummaryService,
    // Формулы (#632): движок, чтение источников, ячейки.
    FormulaEngineProvider,
    { provide: FORMULA_ENGINE, useExisting: FormulaEngineProvider },
    RecordValuesProvider,
    { provide: RECORD_VALUES_READER, useExisting: RecordValuesProvider },
    FormulaCellsRepository,
    FormulaMetaService,
    FormulaValuesService,
    FormulaContextService,
    FormulaCellsService,
    { provide: FORMULA_CELLS, useExisting: FormulaCellsService },
  ],
  exports: [
    CUSTOM_FIELD_REGISTRY,
    NUMBER_ISSUE,
    NUMBER_HOST_REGISTRY,
    NumberRefService,
    CounterSummaryService,
    FORMULA_ENGINE,
    FORMULA_CELLS,
    RECORD_VALUES_READER,
    // Репозиторий ячеек нужен usage-агрегату «В формулах» (F1): сервис
    // определений живёт в CustomFieldsModule, провайдер — здесь (иначе DI
    // не находит FormulaCellsRepository в контексте определения).
    FormulaCellsRepository,
    FormulaMetaService,
    FormulaContextService,
    FormulaValuesService,
  ],
})
export class CustomFieldsPortsModule {}
