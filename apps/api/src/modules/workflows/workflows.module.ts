import { Module } from '@nestjs/common';

import { USER_PROFILE_READER } from '../../core/ports/user-profile.port.js';
import { UserProfileProvider } from '../../core/ports/user-profile.provider.js';
import { ORG_STRUCTURE_READER } from '../../core/ports/org-structure.port.js';
import { OrgStructureProvider } from '../../core/ports/org-structure.provider.js';
import { CatalogBootstrap } from './catalog/catalog.bootstrap.js';
import { CatalogRepository } from './catalog/catalog.repository.js';
import { WorkflowPublishedHandler } from './events/workflow-published.handler.js';
import { ProcessTypesController } from './types/process-types.controller.js';
import { ProcessTypesService } from './types/process-types.service.js';
import { WorkflowEditorController } from './workflow/editor/workflow-editor.controller.js';
import { WorkflowEditorService } from './workflow/editor/publish.service.js';
import { WorkflowPublishRepository } from './workflow/editor/publish.repository.js';
import { WorkflowStageNamesController } from './workflow/editor/stage-names.controller.js';
import { WorkflowStageNamesService } from './workflow/editor/stage-names.service.js';
import { WorkflowSyncJob } from './workflow/editor/workflow-sync.job.js';
import { WorkflowsPortsModule } from './workflows-ports.module.js';
import { CustomFieldsPortsModule } from '../custom-fields/custom-fields-ports.module.js';

/**
 * Модуль «Процессы» (ADR-0024) — ядро платформы (I10, фичефлага нет): типы
 * процессов (задача | письмо), маршруты (стадии, переходы, правила),
 * редактор и публикация версиями (ADR-0021), холст (ADR-0022), системный
 * каталог «засев один раз», фоновый перенос сущностей публикации. Движок
 * работает с сущностями модулей-владельцев через адаптеры (порт
 * `WorkflowEntityAdapter`, регистрация по `workflowCategory`); чужих таблиц
 * не пишет. Порты для владельцев — `WorkflowsPortsModule` (ADR-0012).
 */
@Module({
  // Реестр атрибутов (#431): публикация проверяет ключи `cf.<id>` окна и
  // гейтов по определениям области маршрута.
  imports: [WorkflowsPortsModule, CustomFieldsPortsModule],
  controllers: [ProcessTypesController, WorkflowEditorController, WorkflowStageNamesController],
  providers: [
    UserProfileProvider,
    { provide: USER_PROFILE_READER, useClass: UserProfileProvider },
    // Оргструктура нужна публикации (#433): проверка должностей решающих.
    OrgStructureProvider,
    { provide: ORG_STRUCTURE_READER, useClass: OrgStructureProvider },
    // Репозитории — единственная точка доступа к таблицам модуля (patterns.md).
    CatalogRepository,
    WorkflowPublishRepository,
    CatalogBootstrap,
    ProcessTypesService,
    WorkflowEditorService,
    WorkflowStageNamesService,
    WorkflowSyncJob,
    // Фоновый перенос сущностей публикации ставится из outbox (at-least-once).
    WorkflowPublishedHandler,
  ],
})
export class WorkflowsModule {}
