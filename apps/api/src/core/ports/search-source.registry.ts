import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { searchSourceTypeSchema, type SearchSourceType } from '@nodus/contracts';

import type { SearchSourceProvider } from './search-source.port.js';

/**
 * Реестр провайдеров поисковой проекции (#952, Р5): ядро `search` не
 * импортирует модули-источники — провайдеры объявляют маркер
 * `readonly searchSourceType` среди провайдеров Nest, DiscoveryService
 * находит их при bootstrap (тот же приём, что `fileAccessContext` и
 * `eventType`). Маркер — instance-свойство, не static: DiscoveryService
 * отдаёт экземпляры.
 */
@Injectable()
export class SearchSourceRegistry implements OnModuleInit {
  private providers = new Map<SearchSourceType, SearchSourceProvider>();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    const found = new Map<SearchSourceType, SearchSourceProvider>();
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as unknown;
      if (!isSearchSourceProvider(instance)) continue;
      // Два провайдера одного типа — ошибка сборки графа, а не «последний
      // победил»: молча потерянный источник = невидимые в поиске записи.
      if (found.has(instance.searchSourceType)) {
        throw new Error(
          `SearchSourceRegistry: два провайдера типа «${instance.searchSourceType}» ` +
            `(${found.get(instance.searchSourceType)!.constructor.name} и ${instance.constructor.name})`,
        );
      }
      found.set(instance.searchSourceType, instance);
    }
    this.providers = found;
  }

  /** Провайдер типа; null — модуль-источник выключен или не установлен. */
  get(type: SearchSourceType): SearchSourceProvider | null {
    return this.providers.get(type) ?? null;
  }

  /** Все зарегистрированные провайдеры (детерминированный порядок типов). */
  all(): readonly SearchSourceProvider[] {
    return searchSourceTypeSchema.options
      .map((type) => this.providers.get(type))
      .filter((provider): provider is SearchSourceProvider => provider !== undefined);
  }
}

/** Провайдер похож на источник: валидный маркер типа + методы порта. */
function isSearchSourceProvider(instance: unknown): instance is SearchSourceProvider {
  if (instance === null || typeof instance !== 'object') return false;
  const candidate = instance as {
    searchSourceType?: unknown;
    load?: unknown;
    scan?: unknown;
  };
  return (
    searchSourceTypeSchema.safeParse(candidate.searchSourceType).success &&
    typeof candidate.load === 'function' &&
    typeof candidate.scan === 'function'
  );
}
