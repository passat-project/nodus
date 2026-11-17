import { Module, forwardRef } from '@nestjs/common';

import { ProjectsPortsModule } from '../projects/projects-ports.module.js';
import { CustomFieldsPortsModule } from '../custom-fields/custom-fields-ports.module.js';
import { WorkflowsPortsModule } from '../workflows/workflows-ports.module.js';
import { ORG_STRUCTURE_READER } from '../../core/ports/org-structure.port.js';
import { OrgStructureProvider } from '../../core/ports/org-structure.provider.js';
import { USER_PROFILE_READER } from '../../core/ports/user-profile.port.js';
import { UserProfileProvider } from '../../core/ports/user-profile.provider.js';
import { TaskDeciders } from './access/task-deciders.service.js';
import { TaskDeciderRecipients } from './access/task-decider-recipients.service.js';
import { TaskDecidersRepository } from './access/task-deciders.repository.js';
import { ViewerResolver } from './access/task-visibility.js';
import { CUSTOM_FIELD_VALUES_READER } from './ports/custom-field-values.port.js';
import { TaskCustomFieldValuesProvider } from './ports/custom-field-values.provider.js';
import { TASK_CHAT_READER } from './ports/task-chat-reader.port.js';
import { TaskChatReaderProvider } from './ports/task-chat-reader.provider.js';
import { TASK_PROJECT_READER } from './ports/task-project-reader.port.js';
import { ProjectStaffingProvider } from './ports/project-staffing.provider.js';
import { TaskProjectReaderProvider } from './ports/task-project-reader.provider.js';
import { TASK_REF_READER } from './ports/task-ref-reader.port.js';
import { TaskRefReaderProvider } from './ports/task-ref-reader.provider.js';
import { TASK_FORMULA_VALUES } from './ports/task-formula-values.port.js';
import { TaskFormulaValuesProvider } from './ports/task-formula-values.provider.js';
import { TasksQueryRepository } from './tasks/tasks-query.repository.js';
import { TasksRepository } from './tasks/tasks.repository.js';
import { TaskNumberHostProvider } from './ports/number-host.provider.js';
import { PressRepository } from './press/press.repository.js';
import { WORKFLOW_PRESS_ROUNDS_READER } from '../workflows/ports/workflow-press-rounds.port.js';
import { WorkflowPressRoundsProvider } from './ports/workflow-press-rounds.provider.js';

/**
 * Порты чтения задач (ADR-0012): тонкий модуль экспорта read-портов чужим
 * модулям (chat — беседа задачи, #252; custom-fields — значения атрибутов
 * для окна удаления, #431) — единственная допустимая форма межмодульного
 * импорта; доменные сервисы задач не экспортируются.
 */
@Module({
  imports: [ProjectsPortsModule, forwardRef(() => CustomFieldsPortsModule), WorkflowsPortsModule],
  providers: [
    OrgStructureProvider,
    { provide: ORG_STRUCTURE_READER, useClass: OrgStructureProvider },
    UserProfileProvider,
    { provide: USER_PROFILE_READER, useClass: UserProfileProvider },
    ViewerResolver,
    // Ветка видимости «Статусы участников» (#434): порт-модуль читает отметки
    // открытого раунда; доменный PressService остаётся в TasksModule.
    PressRepository,
    // Публикация маршрута (#434): открытые раунды сбора блокируют правку
    // коллективной кнопки; порт читает отметки через репозиторий задач.
    WorkflowPressRoundsProvider,
    { provide: WORKFLOW_PRESS_ROUNDS_READER, useExisting: WorkflowPressRoundsProvider },
    TaskDecidersRepository,
    TaskDeciderRecipients,
    TaskDeciders,
    TasksQueryRepository,
    TasksRepository,
    // Носитель номеров «задача» (#630): DiscoveryService.
    TaskNumberHostProvider,
    TaskChatReaderProvider,
    { provide: TASK_CHAT_READER, useClass: TaskChatReaderProvider },
    TaskCustomFieldValuesProvider,
    { provide: CUSTOM_FIELD_VALUES_READER, useClass: TaskCustomFieldValuesProvider },
    TaskProjectReaderProvider,
    { provide: TASK_PROJECT_READER, useClass: TaskProjectReaderProvider },
    ProjectStaffingProvider,
    TaskRefReaderProvider,
    { provide: TASK_REF_READER, useExisting: TaskRefReaderProvider },
    // Задачи как источники формул (#632, Р7): значения, системные поля,
    // выборки связанных — только через порт (I3).
    TaskFormulaValuesProvider,
    { provide: TASK_FORMULA_VALUES, useExisting: TaskFormulaValuesProvider },
  ],
  exports: [
    TASK_CHAT_READER,
    CUSTOM_FIELD_VALUES_READER,
    TASK_PROJECT_READER,
    TASK_REF_READER,
    TASK_FORMULA_VALUES,
    WORKFLOW_PRESS_ROUNDS_READER,
  ],
})
export class TasksPortsModule {}
