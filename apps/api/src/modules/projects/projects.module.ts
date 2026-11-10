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
import { ProjectManualMembersService } from './project-manual-members.service.js';
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
import { ProjectFormulaDefinitionHandler } from './events/formula-definition.handler.js';
import {
  ProjectFormulaRecalcHandler,
  ProjectNodeCreatedFormulaHandler,
  ProjectNodeDeletedFormulaHandler,
  ProjectNodeFormulaRecalcHandler,
  ProjectNodeKindFormulaHandler,
  ProjectStructureFormulaRecalcHandler,
  ProjectTypeFormulaHandler,
} from './events/formula-recalc.handler.js';
import { ProjectNodesRepository } from './project-nodes.repository.js';
import { ProjectFormulaEvents } from './project-formula-events.js';
import { ProjectFormulaRecalcService } from './project-formula-recalc.service.js';
import { ProjectFormulaService } from './project-formula.service.js';
import {
  ProjectFormulaTaskSystemHandler,
  TaskCreatedProjectFormulaHandler,
  TaskDeletedProjectFormulaHandler,
  TaskUpdatedProjectFormulaHandler,
} from './events/formula-task-source.handler.js';
import { ProjectStructureController } from './project-structure.controller.js';
import { ProjectStructureService } from './project-structure.service.js';
import { ProjectStructureMoveService } from './project-structure-move.service.js';
import { ProjectValuesWriter } from './project-values.writer.js';
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
 * участие, типы, портфели, настройки портала, дерево структуры и формулы
 * ячеек атрибутов проекта/папки (#632, Р10 — мутации у владельца хоста).
 * За фичефлагом `projects` (I10): выключенный модуль отвечает 404, порты
 * остаются живыми и нейтральными. Чужие модули видят только
 * ProjectsPortsModule (I3/I6).
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
    ProjectManualMembersService,
    ProjectsService,
    ProjectsQueryService,
    ProjectLifecycleService,
    NodeKindsRepository,
    NodeKindsService,
    NodeFormPolicy,
    ProjectNodesRepository,
    ProjectStructureService,
    ProjectStructureMoveService,
    // Формулы ячеек атрибутов (#632): сервис формул проекта/папки и писатель
    // значений (материализация результата — штатным путём, Р4).
    ProjectValuesWriter,
    ProjectFormulaEvents,
    ProjectFormulaService,
    ProjectFormulaRecalcService,
    // Уборка значений удалённого атрибута (#556, Р11): событие custom-fields.
    ProjectFieldValuesCleanupHandler,
    // Пересчёт формул по зависимостям (#632, Р4/Р8): события хостов и реестра.
    ProjectFormulaRecalcHandler,
    ProjectNodeFormulaRecalcHandler,
    ProjectNodeCreatedFormulaHandler,
    ProjectStructureFormulaRecalcHandler,
    ProjectNodeDeletedFormulaHandler,
    ProjectNodeKindFormulaHandler,
    ProjectTypeFormulaHandler,
    ProjectFormulaDefinitionHandler,
    // Пересчёт формул проектов/папок по событиям задач (#632): задачи —
    // источник через ссылку (`v:task:*`) и состав выборки папки (I3).
    TaskUpdatedProjectFormulaHandler,
    ProjectFormulaTaskSystemHandler,
    TaskCreatedProjectFormulaHandler,
    TaskDeletedProjectFormulaHandler,
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
