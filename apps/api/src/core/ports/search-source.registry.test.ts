import type { DiscoveryService } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { SearchSourceRegistry } from './search-source.registry.js';
import type { SearchSourceProvider, SearchScanPage } from './search-source.port.js';

function provider(type: SearchSourceProvider['searchSourceType']): SearchSourceProvider {
  return {
    searchSourceType: type,
    load: async () => [],
    scan: async (): Promise<SearchScanPage> => ({ rows: [], next: null }),
  };
}

/** Реестр на фейковом DiscoveryService: сканирование провайдеров приложения
 *  подменяется списком экземпляров. */
function registryWith(instances: unknown[]): SearchSourceRegistry {
  const discovery = {
    getProviders: () => instances.map((instance) => ({ instance })),
  } as unknown as DiscoveryService;
  const registry = new SearchSourceRegistry(discovery);
  registry.onModuleInit();
  return registry;
}

describe('SearchSourceRegistry (#952)', () => {
  it('находит провайдера по instance-маркеру searchSourceType', () => {
    const task = provider('task');
    const registry = registryWith([task]);
    expect(registry.get('task')).toBe(task);
    expect(registry.get('letter')).toBeNull();
  });

  it('игнорирует объекты без маркера и методов порта', () => {
    const registry = registryWith([
      { handle: async () => {} },
      { searchSourceType: 'task', load: async () => [] }, // нет scan
      { searchSourceType: 'file', load: async () => [], scan: async () => null },
    ]);
    expect(registry.all()).toEqual([]);
  });

  it('all() отдаёт провайдеров в порядке закрытого множества типов', () => {
    const registry = registryWith([provider('employee'), provider('task')]);
    expect(registry.all().map((p) => p.searchSourceType)).toEqual(['task', 'employee']);
  });

  it('два провайдера одного типа — ошибка графа, а не «последний победил»', () => {
    const registry = new SearchSourceRegistry({
      getProviders: () => [{ instance: provider('task') }, { instance: provider('task') }],
    } as unknown as DiscoveryService);
    expect(() => registry.onModuleInit()).toThrow(/два провайдера типа «task»/);
  });
});
