import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { SearchSourceRegistry } from '../../src/core/ports/search-source.registry.js';
import { SearchController } from '../../src/modules/search/search.controller.js';
import { SearchService } from '../../src/modules/search/search.service.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * Бут-гейт P0 (#952): граф приложения собирается с новым ядром `search` и
 * миграцией `search_core` (ensureTestDatabase прогоняет `migrate deploy`,
 * то есть проверяет SQL-функцию и expression-индексы на живой PostgreSQL).
 * Ошибка DI/цикла портов (chat ↔ tasks) валит этот тест, а не прод.
 */
describe('AppModule: фундамент поиска (#952, P0)', () => {
  let module: TestingModule;

  beforeAll(async () => {
    process.env.DATABASE_POOL_MAX = '2';
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = '3000';
    const testUrl = await ensureTestDatabase(process.cwd());
    process.env.DATABASE_URL = testUrl;
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await module.init();
  }, 180_000);

  afterAll(async () => {
    await module?.close();
  });

  it('контроллер, сервис и реестр источников зарегистрированы', () => {
    expect(module.get(SearchController)).toBeDefined();
    expect(module.get(SearchService)).toBeDefined();
    expect(module.get(SearchSourceRegistry)).toBeDefined();
  });

  it('реестр источников пуст — провайдеры модулей подключаются в P2', () => {
    expect(module.get(SearchSourceRegistry).all()).toEqual([]);
  });

  it('диспетчер событий поднят (реестр обработчиков собран без падений)', () => {
    expect(module.get(EventDispatcher)).toBeDefined();
  });
});
