import { Module } from '@nestjs/common';

import { NodeKindsRepository } from './project-node-kinds.repository.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import { ProjectNodesRepository } from './project-nodes.repository.js';
import { ProjectsRepository } from './projects.repository.js';
import { ProjectFieldUsageProvider } from './ports/project-field-usage.provider.js';
import { PROJECT_FIELD_USAGE_READER } from './ports/project-field-usage.port.js';
import { ProjectReaderProvider } from './ports/project-reader.provider.js';
import { PROJECT_CHAT_READER, PROJECT_READER } from './ports/project-reader.port.js';
import {
  ProjectCreatedScopeHandler,
  ProjectParticipantsScopeHandler,
  ProjectUpdatedScopeHandler,
  ProjectScopeInvalidateRunner,
} from './ports/scope-invalidation.handler.js';

/**
 * Порты чтения проектов (ADR-0012): тонкий модуль экспорта read-портов
 * чужим модулям-потребителям (#52 Р11 — задачи, корреспонденция,
 * custom-fields, chat). Единственная допустимая форма межмодульного
 * импорта; доменные сервисы и контроллеры наружу не экспортируются.
 */
@Module({
  providers: [
    ProjectsRepository,
    ProjectParticipantsRepository,
    ProjectNodesRepository,
    NodeKindsRepository,
    ProjectReaderProvider,
    { provide: PROJECT_READER, useExisting: ProjectReaderProvider },
    { provide: PROJECT_CHAT_READER, useExisting: ProjectReaderProvider },
    // Использование атрибутов в проектах и папках (#556, Р11): окно
    // удаления атрибута и виды папок в форме.
    ProjectFieldUsageProvider,
    { provide: PROJECT_FIELD_USAGE_READER, useExisting: ProjectFieldUsageProvider },
    // Сброс кэша множеств видимости по событиям проектов (Р3).
    ProjectScopeInvalidateRunner,
    ProjectCreatedScopeHandler,
    ProjectUpdatedScopeHandler,
    ProjectParticipantsScopeHandler,
  ],
  exports: [PROJECT_READER, PROJECT_CHAT_READER, PROJECT_FIELD_USAGE_READER],
})
export class ProjectsPortsModule {}
