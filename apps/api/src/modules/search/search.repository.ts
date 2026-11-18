import { Injectable } from '@nestjs/common';
import { ErrorCode, type SearchSourceType } from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { buildCountsSql, buildPageSql, type SearchSqlParams } from './search-query.sql.js';

/** Строка выдачи из SQL (до сборки DTO: имена резолвит сервис портами). */
export interface SearchResultRow {
  source_type: SearchSourceType;
  source_id: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  source_created_at: Date;
  author_id: string | null;
  participant_ids: string[];
  score_int: number;
  exact_leg: boolean;
  fts_leg: boolean;
  trgm_leg: boolean;
  cp_leg: boolean;
  title_hit: boolean;
  body_hit: boolean;
  number_hit: boolean;
  recent_hit: boolean;
  body_headline: string;
}

export interface SearchCountRow {
  source_type: SearchSourceType;
  cnt: number;
}

export interface SearchResultPage {
  rows: SearchResultRow[];
  counts: SearchCountRow[];
}

/** Поля номеров для подписи сообщений — из СВОЕЙ проекции (#952 Р9): чужие
 *  таблицы задач/писем отсюда не читаются. */
export interface SearchSourceRefRow {
  source_type: SearchSourceType;
  source_id: string;
  payload: Record<string, unknown>;
}

/**
 * Единственная точка доступа модуля search к `search_documents`/`search_queries`
 * (patterns.md, repository pattern). Чужие таблицы не читаются: источники
 * приходят провайдерами портов (ADR-0012), имена — портами модулей.
 *
 * Тяжёлый запрос ограничен: `statement_timeout=3s` и порог триграмм
 * ставятся SET LOCAL в транзакции (глобальный SET на pooled-соединении
 * изменил бы поведение подсказки контрагентов #460). Таймаут — явный
 * `SEARCH_TIMEOUT` (504), а не пустая выдача.
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

  /** Есть ли в запросе значимые слова (`numnode`): стоп-словный запрос даёт
   *  подсказку «уточните запрос», а не пустоту без объяснения. */
  async hasSearchTerms(q: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT numnode(websearch_to_tsquery('russian', ${q}))::int AS n
    `);
    return (rows[0]?.n ?? 0) > 0;
  }

  /** Счётчики + страница в одной транзакции с локальными настройками. */
  async search(params: SearchSqlParams): Promise<SearchResultPage> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '3000ms'`);
        await tx.$executeRawUnsafe(`SET LOCAL pg_trgm.word_similarity_threshold = 0.4`);
        const counts = await tx.$queryRaw<SearchCountRow[]>(buildCountsSql(params));
        const rows = await tx.$queryRaw<SearchResultRow[]>(buildPageSql(params));
        return { rows, counts };
      });
    } catch (error) {
      if (isStatementTimeout(error)) {
        throw new DomainException(ErrorCode.SEARCH_TIMEOUT, 'Search timed out');
      }
      throw error;
    }
  }

  /** Номера задач/писем для подписей сообщений (своя проекция). */
  async sourceRefs(type: 'task' | 'letter', ids: readonly string[]): Promise<SearchSourceRefRow[]> {
    if (ids.length === 0) return [];
    return this.prisma.$queryRaw<SearchSourceRefRow[]>(Prisma.sql`
      SELECT source_type, source_id, payload
      FROM search_documents
      WHERE source_type = ${type} AND source_id = ANY(${[...new Set(ids)]}::uuid[])
    `);
  }
}

/** Postgres 57014 / Prisma P2028 (закрытая по таймауту транзакция). */
function isStatementTimeout(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : '';
  return (
    code === 'P2028' ||
    code === '57014' ||
    message.includes('57014') ||
    /statement timeout/iu.test(message)
  );
}
