import { Module } from '@nestjs/common';

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
import { CustomFieldsPortsModule } from './custom-fields-ports.module.js';
import { DefinitionsController } from './definitions/definitions.controller.js';
import { DefinitionMapper } from './definitions/definition.mapper.js';
import { DefinitionsRepository } from './definitions/definitions.repository.js';
import { DefinitionsBindingService } from './definitions/definitions-binding.service.js';
import { DefinitionsService } from './definitions/definitions.service.js';
import { DefinitionsQueryService } from './definitions/definitions-query.service.js';
import { DefinitionsUsageService } from './definitions/definitions-usage.service.js';
import { FormulaApiService } from './formulas/formula-api.service.js';
import { FormulaBindingService } from './formulas/formula-binding.service.js';
import { FormulaBindingsController } from './formulas/formula-bindings.controller.js';
import { FormulasController } from './formulas/formulas.controller.js';
import { CustomFieldDefaults } from './values/defaults.js';
import { CustomFieldRefsHydrator } from './values/refs-hydrator.js';
import { CustomFieldValueValidator } from './values/value-validator.js';

/**
 * Реестр кастомных атрибутов (#431, ADR-0029): HTTP-контур `/custom-fields`
 * и сервис определений. Модуль ядра без feature flag (modules.md): атрибуты
 * нужны карточкам, фильтрам и окнам переходов задач, а те уже под флагом
 * `tasks`. Порты для чужих модулей — `CustomFieldsPortsModule`.
 */
@Module({
  imports: [
    DictionariesPortsModule,
    CrmPortsModule,
    CorrespondencePortsModule,
    TasksPortsModule,
    WorkflowsPortsModule,
    ProjectsPortsModule,
    CustomFieldsPortsModule,
  ],
  controllers: [DefinitionsController, FormulasController, FormulaBindingsController],
  providers: [
    UserProfileProvider,
    { provide: USER_PROFILE_READER, useClass: UserProfileProvider },
    OrgStructureProvider,
    { provide: ORG_STRUCTURE_READER, useClass: OrgStructureProvider },
    DefinitionsRepository,
    DefinitionMapper,
    DefinitionsQueryService,
    DefinitionsUsageService,
    CustomFieldValueValidator,
    CustomFieldDefaults,
    CustomFieldRefsHydrator,
    DefinitionsService,
    DefinitionsBindingService,
    FormulaApiService,
    FormulaBindingService,
  ],
})
export class CustomFieldsModule {}
