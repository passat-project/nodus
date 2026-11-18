import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { USER_PROFILE_READER } from '../../core/ports/user-profile.port.js';
import { UserProfileProvider } from '../../core/ports/user-profile.provider.js';
import { SearchSourceRegistry } from '../../core/ports/search-source.registry.js';
import { ChatPortsModule } from '../chat/chat-ports.module.js';
import { CrmPortsModule } from '../crm/crm-ports.module.js';
import { ProjectsPortsModule } from '../projects/projects-ports.module.js';
import { TasksPortsModule } from '../tasks/tasks-ports.module.js';
import { SearchAnalyticsRepository } from './search-analytics.repository.js';
import { SearchController } from './search.controller.js';
import { SearchIndexRunner } from './search-index.handlers.js';
import {
  SearchIndexDirectoryHandler,
  SearchIndexLetterHandler,
  SearchIndexMessageHandler,
  SearchIndexProjectHandler,
  SearchIndexTaskHandler,
} from './search-index.handlers.js';
import { SearchIndexService } from './search-index.service.js';
import { SearchIndexRepository } from './search-index.repository.js';
import { SearchRepository } from './search.repository.js';
import { SearchService } from './search.service.js';
import { SearchVisibilityService } from './search-visibility.service.js';

/**
 * Поиск по порталу (#952): ядро, без фичефлага (I10) — окно нужно каждому.
 * Хранит проекцию `search_documents` (заполняют провайдеры модулей-источников
 * через outbox-события) и таблицу аналитики `search_queries`.
 *
 * Чтение чужих данных — только через read-порты (ADR-0012): видимость задач
 * (TasksPortsModule), проектов (ProjectsPortsModule), бесед (ChatPortsModule),
 * корреспондентов (CrmPortsModule), профили сотрудников (core). Провайдеры
 * источников модули-владельцы регистрируют у себя; DiscoveryModule собирает
 * их по маркеру `searchSourceType` (SearchSourceRegistry).
 */
@Module({
  imports: [
    DiscoveryModule,
    TasksPortsModule,
    ProjectsPortsModule,
    ChatPortsModule,
    CrmPortsModule,
  ],
  controllers: [SearchController],
  providers: [
    SearchRepository,
    SearchService,
    SearchVisibilityService,
    SearchAnalyticsRepository,
    SearchIndexRepository,
    SearchIndexService,
    SearchSourceRegistry,
    UserProfileProvider,
    { provide: USER_PROFILE_READER, useClass: UserProfileProvider },
    // Индексация из outbox (Р6): один runner, пять групп событий.
    SearchIndexRunner,
    SearchIndexTaskHandler,
    SearchIndexMessageHandler,
    SearchIndexLetterHandler,
    SearchIndexProjectHandler,
    SearchIndexDirectoryHandler,
  ],
})
export class SearchModule {}
