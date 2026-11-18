import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/database/prisma.service.js';

/**
 * Единственная точка доступа модуля search к `search_documents`/`search_queries`
 * (patterns.md, repository pattern). Чужие таблицы не читаются: источники
 * приходят провайдерами портов (ADR-0012), имена — портами модулей.
 */
@Injectable()
export class SearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Есть ли в проекции хоть одна строка: отличает «ничего не найдено» от
   *  «индекс ещё не наполнен» (`hint='index_empty'`, #952 Р15). */
  async hasDocuments(): Promise<boolean> {
    const row = await this.prisma.searchDocument.findFirst({ select: { sourceId: true } });
    return row !== null;
  }
}
