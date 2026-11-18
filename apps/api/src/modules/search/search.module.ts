import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { SearchSourceRegistry } from '../../core/ports/search-source.registry.js';
import { SearchController } from './search.controller.js';
import { SearchRepository } from './search.repository.js';
import { SearchService } from './search.service.js';

/**
 * Поиск по порталу (#952): ядро, без фичефлага (I10) — окно нужно каждому.
 * Хранит проекцию `search_documents` (заполняют провайдеры модулей-источников
 * через outbox-события) и таблицу аналитики `search_queries`.
 * DiscoveryModule — сбор провайдеров источников по маркеру
 * `searchSourceType` (SearchSourceRegistry); модули-источники появляются в P2.
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [SearchController],
  providers: [SearchRepository, SearchService, SearchSourceRegistry],
})
export class SearchModule {}
