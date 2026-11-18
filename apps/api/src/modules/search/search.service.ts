import { Inject, Injectable } from '@nestjs/common';
import {
  SEARCH_LIMITS,
  type AuthUser,
  type SearchHint,
  type SearchRequest,
  type SearchResponse,
} from '@nodus/contracts';

import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import {
  CHAT_MEMBERSHIP_READER,
  type ChatConversationRef,
  type ChatMembershipReader,
} from '../chat/membership-reader.port.js';
import {
  COUNTERPARTY_READER,
  type CounterpartyReader,
} from '../crm/ports/counterparty-reader.port.js';
import { PROJECT_READER, type ProjectReader } from '../projects/ports/project-reader.port.js';
import { SearchAnalyticsRepository } from './search-analytics.repository.js';
import { decodeSearchCursor, encodeSearchCursor } from './search-cursor.js';
import { toSearchHit, type SearchHitContext } from './search-hit.mapper.js';
import type { SearchResultRow } from './search.repository.js';
import { SearchRepository } from './search.repository.js';
import { likePrefixPattern, digitsOf } from './search-text.js';
import { SearchVisibilityService } from './search-visibility.service.js';

/** TTL проверки «проекция пуста» (#952 Р15): сигнал «бэкфилл не прогнан»,
 *  а не «ничего не найдено»; рестарт/бэкфилл подхватываются за минуту. */
const INDEX_EMPTY_TTL_MS = 60_000;

/**
 * Поиск по порталу (#952): видимость → три ноги → имена → DTO → аналитика.
 * Никаких чтений чужих таблиц: наборы видимости — порты владельцев,
 * подписи бесед — порт чата и СВОЯ проекция (номера задач/писем).
 */
@Injectable()
export class SearchService {
  private indexState: { empty: boolean; expiresAt: number } | null = null;

  constructor(
    private readonly repo: SearchRepository,
    private readonly analytics: SearchAnalyticsRepository,
    private readonly visibility: SearchVisibilityService,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader,
    @Inject(USER_PROFILE_READER) private readonly users: UserProfileReader,
    @Inject(CHAT_MEMBERSHIP_READER) private readonly chat: ChatMembershipReader,
  ) {}

  async search(actor: AuthUser, request: SearchRequest): Promise<SearchResponse> {
    const startedAt = Date.now();
    const { enabledTypes, sql: visibilitySql } = await this.visibility.build(actor);
    const types = (request.types ?? enabledTypes).filter((type) => enabledTypes.includes(type));

    // Подсказки вместо пустоты: пустая проекция важнее стоп-слов (это сигнал
    // эксплуатации — бэкфилл не прогнан).
    const indexEmpty = await this.isIndexEmpty();
    const hasTerms = indexEmpty ? true : await this.repo.hasSearchTerms(request.q);
    const hint: SearchHint | null = indexEmpty ? 'index_empty' : hasTerms ? null : 'stopwords';

    if (hint !== null || types.length === 0) {
      return this.finish(actor, request, startedAt, {
        items: [],
        nextCursor: null,
        total: 0,
        totalCapped: false,
        facets: { types: {} },
        hint,
      });
    }

    const counterpartyIds = await this.counterparties.searchIds(request.q, 20);
    const page = await this.repo.search({
      q: request.q,
      likePrefix: likePrefixPattern(request.q),
      digits: digitsOf(request.q),
      actorId: actor.id,
      enabledTypes,
      types,
      visibility: visibilitySql,
      projectId: request.projectId,
      conversationId: request.conversationId,
      from: request.from ? new Date(`${request.from}T00:00:00.000Z`) : undefined,
      toExclusive: request.to ? addDays(`${request.to}T00:00:00.000Z`, 1) : undefined,
      counterpartyIds,
      sort: request.sort,
      cursor: decodeSearchCursor(request.cursor, request.sort),
      limit: request.limit,
    });

    const counts = new Map(page.counts.map((row) => [row.source_type, row.cnt]));
    const matched = types.reduce((sum, type) => sum + (counts.get(type) ?? 0), 0);
    const rows = page.rows.slice(0, request.limit);
    const items = await this.toHits(actor, rows, request.q);

    return this.finish(actor, request, startedAt, {
      items,
      nextCursor:
        page.rows.length > request.limit && rows.length > 0
          ? encodeSearchCursor(rows[rows.length - 1]!, request.sort)
          : null,
      total: Math.min(matched, SEARCH_LIMITS.totalCap),
      totalCapped: matched > SEARCH_LIMITS.totalCap,
      // Фасеты — по всем включённым типам, КРОМЕ выбранного фильтра:
      // панель показывает, что ещё доступно (мок-инвариант §6 #952).
      // Количества — по полному предикату совпадения (SearchRepository),
      // а не по окнам ног: «найдено» не упирается в окно FTS.
      facets: {
        types: Object.fromEntries(enabledTypes.map((type) => [type, counts.get(type) ?? 0])),
      },
      hint: null,
    });
  }

  /** Ответ + best-effort аналитика (сбой записи не ломает выдачу, Р13). */
  private finish(
    actor: AuthUser,
    request: SearchRequest,
    startedAt: number,
    response: Omit<SearchResponse, 'tookMs'>,
  ): SearchResponse {
    const result: SearchResponse = { ...response, tookMs: Date.now() - startedAt };
    this.analytics.record(actor, request, {
      total: result.total,
      tookMs: result.tookMs,
      hint: result.hint,
    });
    return result;
  }

  private async isIndexEmpty(): Promise<boolean> {
    const now = Date.now();
    if (this.indexState && this.indexState.expiresAt > now) return this.indexState.empty;
    const empty = !(await this.repo.hasDocuments());
    this.indexState = { empty, expiresAt: now + INDEX_EMPTY_TTL_MS };
    return empty;
  }

  /** Имена/подписи — при выдаче, из индекса только id (Р9). */
  private async toHits(
    actor: AuthUser,
    rows: readonly SearchResultRow[],
    query: string,
  ): Promise<SearchResponse['items']> {
    const projectIds = new Set<string>();
    const counterpartyIds = new Set<string>();
    const conversationIds = new Set<string>();
    const authorIds = new Set<string>();
    for (const row of rows) {
      if (row.source_type === 'task') {
        const id = row.payload['projectId'];
        if (typeof id === 'string') projectIds.add(id);
      }
      if (row.source_type === 'letter') {
        const id = row.payload['counterpartyId'];
        if (typeof id === 'string') counterpartyIds.add(id);
      }
      if (row.source_type === 'message') {
        const id = row.payload['conversationId'];
        if (typeof id === 'string') conversationIds.add(id);
        if (row.author_id) authorIds.add(row.author_id);
      }
    }

    const [projectRefs, counterpartyRefs, authorRefs, conversations] = await Promise.all([
      this.projects.refsFor(actor, [...projectIds]),
      this.counterparties.refs([...counterpartyIds]),
      this.users.findRefs([...authorIds]),
      this.chat.conversationRefs([...conversationIds]),
    ]);
    const conversationMap = new Map<string, ChatConversationRef>(
      conversations.map((ref) => [ref.id, ref]),
    );
    const taskIds = conversations.flatMap((ref) => (ref.taskId ? [ref.taskId] : []));
    const letterIds = conversations.flatMap((ref) => (ref.letterId ? [ref.letterId] : []));
    const [taskRows, letterRows] = await Promise.all([
      this.repo.sourceRefs('task', taskIds),
      this.repo.sourceRefs('letter', letterIds),
    ]);

    const context: SearchHitContext = {
      actorId: actor.id,
      query,
      projectNames: new Map(projectRefs.map((ref) => [ref.id, ref.name])),
      counterpartyNames: new Map(counterpartyRefs.map((ref) => [ref.id, ref.name])),
      authorNames: new Map(authorRefs.map((ref) => [ref.id, ref.displayName])),
      conversations: conversationMap,
      taskNumbers: new Map(
        taskRows.flatMap((row) =>
          typeof row.payload['number'] === 'number'
            ? [[row.source_id, row.payload['number'] as number] as const]
            : [],
        ),
      ),
      letterNumbers: new Map(
        letterRows.flatMap((row) =>
          typeof row.payload['regNumber'] === 'string'
            ? [[row.source_id, row.payload['regNumber']] as const]
            : [],
        ),
      ),
    };
    return rows.map((row) => toSearchHit(row, context));
  }
}

/** `YYYY-MM-DDT00:00Z` + N дней (фильтр `to` включительный, #952 Р7). */
function addDays(iso: string, days: number): Date {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}
