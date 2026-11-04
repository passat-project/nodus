import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  CounterpartyCard,
  CounterpartyListItem,
  CounterpartyMatch,
  ListCounterpartiesQuery,
  Paginated,
  SimilarCounterpartiesQuery,
} from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { decodeCursor, encodeCursor } from '../../../core/pagination/cursor.util.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import {
  LETTER_VISIBILITY_READER,
  type LetterVisibilityReader,
  type LetterVisibilityViewer,
} from '../../correspondence/ports/letter-visibility.port.js';
import { ContactsRepository } from '../contacts/contacts.repository.js';
import { SIMILAR_LIMIT, SIMILAR_NAME_THRESHOLD, similarNameQuery } from './counterparty-match.js';
import { toCounterpartyCard, toCounterpartyListItem } from './counterparty-dto.mapper.js';
import {
  CounterpartiesRepository,
  type CounterpartyCounts,
  type CounterpartyRow,
} from './counterparties.repository.js';

const listCursorSchema = z.object({ shortName: z.string().min(1), id: z.uuid() });

/**
 * Чтения модуля crm: реестр (keyset + серверный поиск + фильтр архива),
 * карточка (контакты и счётчики) и подсказка похожих. Сборка карточки живёт
 * здесь одна — её же использует сервис мутаций для ответа.
 */
@Injectable()
export class CounterpartiesQueryService {
  constructor(
    private readonly counterparties: CounterpartiesRepository,
    private readonly contacts: ContactsRepository,
    @Inject(LETTER_VISIBILITY_READER) private readonly letters: LetterVisibilityReader,
  ) {}

  async list(
    query: ListCounterpartiesQuery,
    viewer: LetterVisibilityViewer,
  ): Promise<Paginated<CounterpartyListItem>> {
    const after = query.cursor ? decodeCursor(query.cursor, listCursorSchema) : null;
    const rows = await this.counterparties.findPage(
      { search: query.search, includeArchived: query.includeArchived },
      after,
      query.limit,
    );
    const items = rows.slice(0, query.limit);
    const ids = items.map((row) => row.id);
    const [usages, contactCounts] = await Promise.all([
      this.countsOf(ids, viewer),
      this.contacts.countActiveByCounterparties(ids),
    ]);
    const last = items.at(-1);
    return {
      items: items.map((row) =>
        toCounterpartyListItem(row, {
          lettersCount: usages.get(row.id)?.lettersCount ?? 0,
          projectsCount: usages.get(row.id)?.projectsCount ?? 0,
          contactsCount: contactCounts.get(row.id) ?? 0,
        }),
      ),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ shortName: last.shortName, id: last.id })
          : null,
    };
  }

  async card(id: string, viewer: LetterVisibilityViewer): Promise<CounterpartyCard> {
    const row = await this.counterparties.findById(id);
    if (!row) {
      throw DomainException.notFound('Counterparty not found');
    }
    return this.buildCard(row, undefined, viewer);
  }

  /** Сборка карточки из строки (без повторного чтения самой сущности). */
  async buildCard(
    row: CounterpartyRow,
    tx?: TransactionClient,
    viewer?: LetterVisibilityViewer,
  ): Promise<CounterpartyCard> {
    const [contacts, usages] = await Promise.all([
      this.contacts.findByCounterparty(row.id, tx),
      this.countsOf([row.id], viewer),
    ]);
    const counts = usages.get(row.id) ?? { lettersCount: 0, projectsCount: 0 };
    return toCounterpartyCard(row, contacts, counts);
  }

  /** Счётчики связей с правилом видимости писем (#461, Р4): без зрителя
   *  (внутренние ответы мутаций) — полные числа, со зрителем — минус
   *  невидимые ему конфиденциальные. */
  private async countsOf(
    ids: readonly string[],
    viewer?: LetterVisibilityViewer,
  ): Promise<Map<string, Omit<CounterpartyCounts, 'contactsCount'>>> {
    const counts = await this.counterparties.countsByIds(ids);
    if (!viewer) return counts;
    const usages = await this.counterparties.letterUsages(ids);
    const visible = await this.letters.visibleLetterIds(
      usages.map((usage) => usage.sourceId),
      viewer,
    );
    for (const usage of usages) {
      if (visible.has(usage.sourceId)) continue;
      const current = counts.get(usage.counterpartyId);
      if (current) current.lettersCount = Math.max(0, current.lettersCount - 1);
    }
    return counts;
  }

  /**
   * Подсказка похожих: точный УНП и/или нечёткое сходство названия
   * (`word_similarity`). Пустой запрос — пустой ответ (без запроса к БД).
   */
  async similar(query: SimilarCounterpartiesQuery): Promise<CounterpartyMatch[]> {
    const name = similarNameQuery(query.name);
    const unp = query.unp ?? null;
    if (unp === null && name === '') return [];
    const rows = await this.counterparties.findSimilar({
      unp,
      name,
      threshold: SIMILAR_NAME_THRESHOLD,
      limit: SIMILAR_LIMIT,
    });
    return rows.map((row) => ({
      id: row.id,
      shortName: row.shortName,
      fullName: row.fullName,
      unp: row.unp,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      matchedBy: row.unpMatch ? 'unp' : 'name',
    }));
  }
}
