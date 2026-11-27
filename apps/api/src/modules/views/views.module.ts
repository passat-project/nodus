import { Module } from '@nestjs/common';

import { CustomFieldsPortsModule } from '../custom-fields/custom-fields-ports.module.js';
import { CorrespondencePortsModule } from '../correspondence/correspondence-ports.module.js';
import { ProjectsPortsModule } from '../projects/projects-ports.module.js';
import { TasksPortsModule } from '../tasks/tasks-ports.module.js';
import { WorkflowsPortsModule } from '../workflows/workflows-ports.module.js';
import { ListExportsRepository } from './list-exports.repository.js';
import { ListExportService } from './list-export.service.js';
import {
  FOLDER_LIST_EXPORT_SOURCE,
  LETTER_LIST_EXPORT_SOURCE,
  LIST_EXPORT_SOURCE,
  TASK_LIST_EXPORT_SOURCE,
} from './list-export-source.port.js';
import { SavedViewsRepository } from './saved-views.repository.js';
import { SavedViewsService } from './saved-views.service.js';
import { ViewsController } from './views.controller.js';
import { ViewsExportQueue } from './views-export.queue.js';
import { ViewsExportWorker } from './views-export.worker.js';

/**
 * Модуль views (#435): сохранённые настройки списков (виды трёх уровней) и
 * выгрузка CSV. Строки сущностей модуль не читает — только через источники
 * LIST_EXPORT_SOURCE (реализации — порты модулей-владельцев, I3). Таблицы
 * saved_views/list_exports — собственные; фичефлага нет (платформенная
 * механика списков, ядро).
 */
@Module({
  imports: [
    TasksPortsModule,
    CorrespondencePortsModule,
    ProjectsPortsModule,
    WorkflowsPortsModule,
    CustomFieldsPortsModule,
  ],
  controllers: [ViewsController],
  providers: [
    SavedViewsRepository,
    SavedViewsService,
    ListExportsRepository,
    ViewsExportQueue,
    ViewsExportWorker,
    ListExportService,
    // Источники строк выгрузки по сущностям (Nest не мержит один токен из
    // нескольких модулей — собираем массив фабрикой).
    {
      provide: LIST_EXPORT_SOURCE,
      useFactory: (task: unknown, letter: unknown, folder: unknown) => [task, letter, folder],
      inject: [TASK_LIST_EXPORT_SOURCE, LETTER_LIST_EXPORT_SOURCE, FOLDER_LIST_EXPORT_SOURCE],
    },
  ],
})
export class ViewsModule {}
