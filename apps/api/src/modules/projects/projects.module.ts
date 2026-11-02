import { Module } from '@nestjs/common';

import { USER_PROFILE_READER } from '../../core/ports/user-profile.port.js';
import { UserProfileProvider } from '../../core/ports/user-profile.provider.js';
import { CrmPortsModule } from '../crm/crm-ports.module.js';
import { CustomFieldsPortsModule } from '../custom-fields/custom-fields-ports.module.js';
import { TasksPortsModule } from '../tasks/tasks-ports.module.js';
import { ProjectCatalogsController } from './project-catalogs.controller.js';
import { ProjectGroupsRepository } from './project-groups.repository.js';
import { ProjectHistoryRepository } from './project-history.repository.js';
import { ProjectMembersController } from './project-members.controller.js';
import { ProjectNodeKindsController } from './project-node-kinds.controller.js';
import { ProjectLifecycleService } from './project-lifecycle.service.js';
import { ProjectMembersService } from './project-members.service.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import { ProjectTypesRepository } from './project-types.repository.js';
import { ProjectDtoMapper } from './project-dto.mapper.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsRepository } from './projects.repository.js';
import { ProjectsQueryService } from './projects-query.service.js';
import { ProjectsService } from './projects.service.js';
import { NodeKindsRepository } from './project-node-kinds.repository.js';
import { NodeKindsService } from './node-kinds.service.js';
import { NodeFormPolicy } from './node-form.policy.js';
import { ProjectFieldValuesCleanupHandler } from './events/project-field-values-cleanup.handler.js';
import { ProjectNodesRepository } from './project-nodes.repository.js';
import { ProjectStructureController } from './project-structure.controller.js';
import { ProjectStructureService } from './project-structure.service.js';
import { ProjectStructureMoveService } from './project-structure-move.service.js';
import {
  TaskAssignedProjectHandler,
  TaskCreatedProjectHandler,
  TaskDeletedProjectHandler,
  TaskParticipantsProjectionRunner,
  TaskParticipantsProjectHandler,
  TaskUpdatedProjectHandler,
} from './events/task-participants.handler.js';

/**
 * Модуль «Проекты» (#52, ADR-0030): журнал/карточка/создание, двухрежимное
 * участие, типы, портфели, настройки портала. За фичефлагом `projects`
 * (I10): выключенный модуль отвечает 404, порты нейтральны. Чужие модули
 * видят только ProjectsPortsModule (I3/I6).
 */
@Module({
  imports: [CrmPortsModule, CustomFieldsPortsModule, TasksPortsModule],
  controllers: [
    ProjectsController,
    ProjectMembersController,
    ProjectCatalogsController,
    ProjectNodeKindsController,
    ProjectStructureController,
  ],
  providers: [
    UserProfileProvider,
    { provide: USER_PROFILE_READER, useClass: UserProfileProvider },
    ProjectsRepository,
    ProjectParticipantsRepository,
    ProjectTypesRepository,
    ProjectGroupsRepository,
    ProjectHistoryRepository,
    ProjectDtoMapper,
    ProjectMembersService,
    ProjectsService,
    ProjectsQueryService,
    ProjectLifecycleService,
    NodeKindsRepository,
    NodeKindsService,
    NodeFormPolicy,
    ProjectNodesRepository,
    ProjectStructureService,
    ProjectStructureMoveService,
    // Уборка значений удалённого атрибута (#556, Р11): событие custom-fields.
    ProjectFieldValuesCleanupHandler,
    // Проекция участия «из задач» (Р2): события task.*.
    TaskParticipantsProjectionRunner,
    TaskCreatedProjectHandler,
    TaskUpdatedProjectHandler,
    TaskAssignedProjectHandler,
    TaskParticipantsProjectHandler,
    TaskDeletedProjectHandler,
  ],
})
export class ProjectsModule {}
