import { Injectable } from '@nestjs/common';
import type { SearchSourceType } from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import { SearchSourceRegistry } from '../../core/ports/search-source.registry.js';
import {
  SEARCH_SOURCE_LIMITS,
  type SearchSourceDocument,
} from '../../core/ports/search-source.port.js';
import { SearchIndexRepository } from './search-index.repository.js';
import { clampSearchText } from './search-text.js';

/**
 * Индексатор проекции (#952, Р6/Р16): точечная переиндексация по id из
 * outbox-событий и полный скан для бэкфилла. Провайдеры источников —
 * единственный путь чтения чужих данных (ADR-0012); запись — только в
 * `search_documents` (SearchIndexRepository).
 *
 * Текст чистится и обрезается здесь, а не в провайдерах: C0-символы (кроме
 * `\n`/`\t`) вырезаются до записи — маркеры сниппета `\u0001`/`\u0002` не
 * могут прийти из данных (Р8); title ≤ 500, body ≤ 4000 (Р15).
 */
@Injectable()
export class SearchIndexService {
  constructor(
    private readonly repository: SearchIndexRepository,
    private readonly registry: SearchSourceRegistry,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SearchIndexService.name);
  }

  /** Точечно переиндексировать источники (события, ручные пересчёты). */
  async indexIds(type: SearchSourceType, ids: readonly string[]): Promise<void> {
    const provider = this.registry.get(type);
    const unique = [...new Set(ids)];
    if (!provider || unique.length === 0) return;
    await this.apply(await provider.load(unique));
  }

  /** Переименование/архивация подразделения: переиндексировать его сотрудников. */
  async indexByDepartment(departmentId: string): Promise<void> {
    const provider = this.registry.get('employee');
    if (!provider?.loadByDepartment) return;
    await this.apply(await provider.loadByDepartment(departmentId));
  }

  /** Переименование/переназначение должности: держатели меняют текст. */
  async indexByPosition(positionId: string): Promise<void> {
    const provider = this.registry.get('employee');
    if (!provider?.loadByPosition) return;
    await this.apply(await provider.loadByPosition(positionId));
  }

  /** Полный скан источника для бэкфилла; возвращает число обработанных строк
   *  (включая tombstones — скан снимает устаревшие строки). */
  async scan(type: SearchSourceType): Promise<number> {
    const provider = this.registry.get(type);
    if (!provider) return 0;
    let cursor = null as Awaited<ReturnType<typeof provider.scan>>['next'];
    let processed = 0;
    do {
      const page = await provider.scan(cursor, 500);
      await this.apply(page.rows);
      processed += page.rows.length;
      cursor = page.next;
      // Пустая страница с непустым курсором — защита от вечного цикла
      // провайдера, который не двигает курсор.
      if (page.rows.length === 0) break;
    } while (cursor !== null);
    this.logger.info({ type, processed }, 'Search source scan finished');
    return processed;
  }

  /** Tombstone удаляет строку; остальные — upsert в одной транзакции пачки. */
  private async apply(documents: readonly SearchSourceDocument[]): Promise<void> {
    const rows = documents.flatMap((document) =>
      'deleted' in document
        ? []
        : [
            {
              ...document,
              title: clampSearchText(document.title, SEARCH_SOURCE_LIMITS.title),
              body: clampSearchText(document.body, SEARCH_SOURCE_LIMITS.body),
              keywords: clampSearchText(document.keywords, SEARCH_SOURCE_LIMITS.title),
            },
          ],
    );
    await this.repository.apply(rows);
    for (const document of documents) {
      if ('deleted' in document) {
        await this.repository.remove(document.type, document.id, document.sourceUpdatedAt);
      }
    }
  }
}
