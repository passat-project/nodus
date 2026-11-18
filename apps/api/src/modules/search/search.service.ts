import { Injectable } from '@nestjs/common';
import type { AuthUser, SearchRequest, SearchResponse } from '@nodus/contracts';

import { SearchRepository } from './search.repository.js';

/**
 * Поиск по порталу (#952). P0 — скелет: контракт и маршрут зафиксированы,
 * выдача пустая; три ноги (exact/FTS/trigram), pre-filter видимости,
 * сниппеты и аналитика — пакет P2 (план #952 §7).
 */
@Injectable()
export class SearchService {
  constructor(private readonly repo: SearchRepository) {}

  async search(actor: AuthUser, request: SearchRequest): Promise<SearchResponse> {
    const startedAt = Date.now();
    // P2: pre-filter видимости портами + ранжирование по проекции.
    void actor;
    void request;
    const hasDocuments = await this.repo.hasDocuments();
    return {
      items: [],
      nextCursor: null,
      total: 0,
      totalCapped: false,
      facets: { types: {} },
      hint: hasDocuments ? null : 'index_empty',
      tookMs: Date.now() - startedAt,
    };
  }
}
