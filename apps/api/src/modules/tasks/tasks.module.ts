import { Module } from '@nestjs/common';

import { ORG_STRUCTURE_READER } from '../../core/ports/org-structure.port.js';
import { OrgStructureProvider } from '../../core/ports/org-structure.provider.js';
import { USER_PROFILE_READER } from '../../core/ports/user-profile.port.js';
import { UserProfileProvider } from '../../core/ports/user-profile.provider.js';
import { ChatPortsModule } from '../chat/chat-ports.module.js';
import { CustomFieldsPortsModule } from '../custom-fields/custom-fields-ports.module.js';
import { WorkflowsPortsModule } from '../workflows/workflows-ports.module.js';
import { TaskProjectRights } from './access/task-project-rights.js';
import { ViewerResolver } from './access/task-visibility.js';
import { TaskDeciders } from './access/task-deciders.service.js';
import { TaskDeciderRecipients } from './access/task-decider-recipients.service.js';
import { TaskDecidersRepository } from './access/task-deciders.repository.js';
import { HistoryRepository } from './activity/history.repository.js';
import { HistoryService } from './activity/history.service.js';
import { RelationsRepository } from './activity/relations.repository.js';
import { RelationsService } from './activity/relations.service.js';
import { ResultsRepository } from './activity/results.repository.js';
import { ResultRevisions } from './activity/result-revisions.js';
import { ResultsService } from './activity/results.service.js';
import { TaskPartsController } from './activity/task-parts.controller.js';
import { BulkService } from './bulk/bulk.service.js';
import { ChecklistRepository } from './checklist/checklist.repository.js';
import { ChecklistService } from './checklist/checklist.service.js';
import {
  TaskCommentDeletedHandler,
  TaskCommentSentHandler,
  TaskCommentsCounter,
} from './events/comments-count.handler.js';
import { CustomFieldValuesCleanupHandler } from './events/custom-field-values-cleanup.handler.js';
import {
  TaskAssignedFormulaHandler,
  TaskCreatedFormulaSourceHandler,
  TaskDeletedFormulaSourceHandler,
  TaskRelationFormulaHandler,
  TaskStageFormulaHandler,
  TaskSystemFieldRunner,
  TaskTypeFormulaHandler,
} from './events/formula-lifecycle.handler.js';
import {
  TaskFormulaDefinitionHandler,
  TaskFormulaRecalcHandler,
} from './events/formula-recalc.handler.js';
import {
  TaskFormulaNodeDeletedSourceHandler,
  TaskFormulaNodeSourceHandler,
  TaskFormulaProjectSourceHandler,
  TaskFormulaTreeCreatedHandler,
  TaskFormulaTreeDeletedHandler,
  TaskFormulaTreeMovedHandler,
  TaskFormulaTreeRunner,
} from './events/formula-source-recalc.handler.js';
import { OverdueScanner } from './events/overdue.scanner.js';
import { ParticipantsRepository } from './participants/participants.repository.js';
import { ParticipantsService } from './participants/participants.service.js';
import { PersonalBoardsRepository } from './personal/personal-boards.repository.js';
import { PersonalStagesService } from './personal/personal-stages.service.js';
import { PersonalTemplateBootstrap } from './personal/personal-template.bootstrap.js';
import { Placements } from './personal/placements.js';
import { PlacementsRepository } from './personal/placements.repository.js';
import { TaskCreatePolicy } from './tasks/task-create.policy.js';
import { TaskDtoMapper } from './tasks/task-dto.mapper.js';
import { TaskFactsRepository } from './tasks/task-facts.repository.js';
import { TaskEditService } from './tasks/task-edit.service.js';
import { TaskFormulaService } from './tasks/task-formula.service.js';
import { TaskFieldsWriter } from './tasks/task-fields.writer.js';
import { ProjectsPortsModule } from '../projects/projects-ports.module.js';
import { TasksController } from './tasks/tasks.controller.js';
import { TasksQueryRepository } from './tasks/tasks-query.repository.js';
import { TasksQueryService } from './tasks/tasks-query.service.js';
import { TasksRepository } from './tasks/tasks.repository.js';
import { TasksService } from './tasks/tasks.service.js';
import { TimeEntriesRepository } from './time/time-entries.repository.js';
import { TimeController } from './time/time.controller.js';
import { TimeService } from './time/time.service.js';
import { TaskTypeChangeService } from './types/task-type-change.service.js';
import { StageMover } from './workflow/stage-mover.js';
import { TaskFormApplier } from './workflow/task-form.applier.js';
import { TaskTransitionsService } from './workflow/task-transitions.service.js';
import { TaskWorkflowAdapter } from './workflow/task-workflow.adapter.js';
import { TaskWorkflowController } from './workflow/task-workflow.controller.js';

/**
 * Модуль tasks (#37, эпик M4 #49; ADR-0008, ADR-0020, ADR-0024):
 * самостоятельные задачи (проект необязателен), «Мой план», участники,
 * чек-лист, время, результат, связи, история, bulk. Движок маршрутов, типы
 * процессов, редактор и публикация — модуль «Процессы» (`workflows`): задачи
 * подключаются к нему адаптером сущности (TaskWorkflowAdapter, категория
 * `task`) и портами WORKFLOW_ENGINE / PROCESS_CATALOG_READER. Личные маршруты
 * «Моего плана» — явное временное исключение ADR-0024 до #438/#439: их
 * таблицы читает и пишет только PersonalBoardsRepository. Изоляция (I3/I6):
 * профили и оргструктура — read-порты core (ADR-0012); чат задачи — модуль
 * chat по событиям task.* (#252). Флаг `tasks` (I10).
 */
@Module({
  // Read-порты чата (ADR-0012): доступ к сообщению для «В задачу»/результата.
  // WorkflowsPortsModule — порты «Процессов»: движок и читатель каталога.
  // Реестр атрибутов (#431): значения, умолчания и проверка — порт, не таблица.
  imports: [ChatPortsModule, WorkflowsPortsModule, CustomFieldsPortsModule, ProjectsPortsModule],
  controllers: [TasksController, TaskWorkflowController, TaskPartsController, TimeController],
  providers: [
    UserProfileProvider,
    { provide: USER_PROFILE_READER, useClass: UserProfileProvider },
    OrgStructureProvider,
    { provide: ORG_STRUCTURE_READER, useClass: OrgStructureProvider },
    // Репозитории — единственная точка доступа к таблицам модуля (patterns.md).
    TasksRepository,
    TasksQueryRepository,
    TaskFactsRepository,
    PlacementsRepository,
    PersonalBoardsRepository,
    ParticipantsRepository,
    ChecklistRepository,
    TimeEntriesRepository,
    ResultsRepository,
    RelationsRepository,
    HistoryRepository,
    ViewerResolver,
    TaskProjectRights,
    // Решающие (#433): факты актора, вакансии, видимость и адресаты.
    TaskDecidersRepository,
    TaskDeciderRecipients,
    TaskDeciders,
    StageMover,
    // Общие писатели полей/времени/итога (#380): окно перехода и PATCH
    // правят задачу одной доменной логикой, а не копиями.
    TaskFieldsWriter,
    TaskFormApplier,
    // Политика создания по типу (#432): скрытые значения и обязательность
    // на всех путях создания — одна точка.
    TaskCreatePolicy,
    ResultRevisions,
    // Адаптер задач для движка «Процессов» (ADR-0024): регистрируется
    // DiscoveryService по статическому workflowCategory.
    TaskWorkflowAdapter,
    TaskTransitionsService,
    TaskTypeChangeService,
    Placements,
    PersonalTemplateBootstrap,
    TaskDtoMapper,
    TasksQueryService,
    TasksService,
    TaskEditService,
    TaskFormulaService,
    PersonalStagesService,
    ParticipantsService,
    ChecklistService,
    TimeService,
    ResultsService,
    RelationsService,
    HistoryService,
    BulkService,
    OverdueScanner,
    // Счётчик комментариев = сообщения беседы задачи (#252, события chat.*).
    TaskCommentsCounter,
    TaskCommentSentHandler,
    TaskCommentDeletedHandler,
    // Уборка значений удалённого атрибута (#431): событие custom_field.definition_changed.
    CustomFieldValuesCleanupHandler,
    TaskFormulaRecalcHandler,
    TaskFormulaDefinitionHandler,
    // Пересчёт формул задач по событиям-источникам чужих модулей (#632):
    // значения и структура проектов/папок — пишутся только ячейки задач (I3).
    TaskFormulaProjectSourceHandler,
    TaskFormulaNodeSourceHandler,
    TaskFormulaNodeDeletedSourceHandler,
    TaskFormulaTreeRunner,
    TaskFormulaTreeCreatedHandler,
    TaskFormulaTreeMovedHandler,
    TaskFormulaTreeDeletedHandler,
    // Жизненный цикл задачи: связи, создание и удаление (агрегаты родителя).
    TaskRelationFormulaHandler,
    TaskCreatedFormulaSourceHandler,
    TaskDeletedFormulaSourceHandler,
    // Системные поля без task.updated: стадия и ответственный (Р4).
    TaskSystemFieldRunner,
    TaskStageFormulaHandler,
    TaskAssignedFormulaHandler,
    // Смена типа: доступность атрибутов места изменилась (Р3/Р13).
    TaskTypeFormulaHandler,
  ],
})
export class TasksModule {}
