import { Module, forwardRef } from '@nestjs/common';

import { ORG_STRUCTURE_READER } from '../../core/ports/org-structure.port.js';
import { OrgStructureProvider } from '../../core/ports/org-structure.provider.js';
import { USER_PROFILE_READER } from '../../core/ports/user-profile.port.js';
import { UserProfileProvider } from '../../core/ports/user-profile.provider.js';
import { ProjectsPortsModule } from '../projects/projects-ports.module.js';
import { CrmPortsModule } from '../crm/crm-ports.module.js';
import { CorrespondencePortsModule } from '../correspondence/correspondence-ports.module.js';
import { DictionariesPortsModule } from '../dictionaries/dictionaries-ports.module.js';
import { TasksPortsModule } from '../tasks/tasks-ports.module.js';
import { CustomFieldRegistryProvider } from './ports/custom-field-registry.provider.js';
import { CUSTOM_FIELD_REGISTRY } from './ports/custom-field-registry.port.js';
import { DefinitionMapper } from './definitions/definition.mapper.js';
import { DefinitionsRepository } from './definitions/definitions.repository.js';
import { CustomFieldDefaults } from './values/defaults.js';
import { CustomFieldRefsHydrator } from './values/refs-hydrator.js';
import { CustomFieldValueValidator } from './values/value-validator.js';

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
    DictionariesPortsModule,
    CrmPortsModule,
    ProjectsPortsModule,
    forwardRef(() => TasksPortsModule),
    CorrespondencePortsModule,
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
  ],
  exports: [CUSTOM_FIELD_REGISTRY],
})
export class CustomFieldsPortsModule {}
