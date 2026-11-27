import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ErrorCode,
  type AuthUser,
  type LetterListItem,
  type ListGroupBucket,
  type ListLettersQuery,
  type ListResult,
  type ListSort,
  type ListTotalValue,
  toListQueryExt,
} from '@nodus/contracts';

import { decodeCursor, encodeCursor } from '../../../core/pagination/cursor.util.js';
import {
  assertListField,
  buildStageFlagIndex,
  filterSql,
  type ListExtCursor,
  type ListSqlContext,
} from '../../../core/lists/list-ext-sql.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import {
  type CounterpartyReader,
  COUNTERPARTY_READER,
} from '../../crm/ports/counterparty-reader.port.js';
import { canRegisterLetters, canViewConfidential } from '../access/letter-access.js';
import { letterListSqlContext, LettersExtRepository } from './letters-ext.repository.js';
import { LettersQueryService } from './letters-query.service.js';
import { LettersRepository } from './letters.repository.js';

/** Поиск по корреспонденту: сколько контрагентов подмешивать в OR. */
const SEARCH_COUNTERPARTIES = 50;

const extCursor = z.object({
  o: z.array(z.union([z.string(), z.number(), z.null()])),
  id: z.uuid(),
});

/**
 * Список писем с расширением (#435): фильтр — предикаты общей выборки #635,
 * сортировка по любой колонке (включая атрибуты JSONB), группы и итоги по
 * всей выборке ящика. Видимость одна — SQL-эквивалент boxWhere +
 * confidentialityWhere (LettersExtRepository.frameSql).
 */
@Injectable()
export class LettersExtService {
  constructor(
    private readonly ext: LettersExtRepository,
    private readonly repo: LettersRepository,
    private readonly reads: LettersQueryService,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader,
  ) {}

  async list(user: AuthUser, q: ListLettersQuery): Promise<ListResult<LetterListItem>> {
    if (q.box === 'new' && !canRegisterLetters(user)) {
      throw new DomainException(ErrorCode.FORBIDDEN, 'Letter registration permission required');
    }
    const ext = toListQueryExt(q);
    const [defs, stageFlags] = await Promise.all([
      this.customFields.definitions(),
      this.catalog.liveStageFlags('letter'),
    ]);
    const ctx = letterListSqlContext(new Map(defs.map((d) => [d.id, d])));
    this.assertFields(ext, ctx);
    const stages = buildStageFlagIndex(stageFlags);

    const parts: Prisma.Sql[] = this.ext.frameSql(q, user.id, canViewConfidential(user));
    if (q.counterpartyId) parts.push(Prisma.sql`l.counterparty_id = ${q.counterpartyId}::uuid`);
    if (q.search) {
      const counterpartyIds = await this.counterparties.searchIds(q.search, SEARCH_COUNTERPARTIES);
      parts.push(this.ext.searchSql(q.search, counterpartyIds));
    }
    if (ext.filter.length > 0) parts.push(filterSql(ext.filter, ctx, stages));
    const where = Prisma.join(parts, ' AND ');

    const sorts: ListSort[] = ext.group
      ? [{ field: ext.group.field, dir: 'asc' }, ...ext.sort]
      : ext.sort;
    const cursor = q.cursor ? (decodeCursor(q.cursor, extCursor) as ListExtCursor) : undefined;

    const [page, groupsRow, totalsRow] = await Promise.all([
      this.ext.page(where, sorts, cursor, q.limit, ctx),
      ext.group ? this.ext.groups(where, ext.group.field, ext.totals, ctx) : Promise.resolve(null),
      ext.totals.length > 0 ? this.ext.totals(where, ext.totals, ctx) : Promise.resolve(null),
    ]);

    const hasMore = page.ids.length > q.limit;
    const ids = page.ids.slice(0, q.limit);
    const values = page.sortValues.slice(0, q.limit);
    const last = ids.length - 1;
    const nextCursor =
      hasMore && last >= 0 ? encodeCursor({ o: values[last], id: ids[last]! }) : null;

    // Гидратация — общий конвейер списка (счётчики, viewed, «ответ на …»).
    const byId = new Map((await this.repo.rowsByIds(ids)).map((row) => [row.id, row]));
    const rows = ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined);
    const items = await this.reads.pageItems(user, rows);
    const groups: ListGroupBucket[] | undefined = groupsRow
      ? groupsRow.map((bucket) => ({
          key: bucket.key,
          count: bucket.count,
          totals: ext.totals.map((total, i) => ({
            fn: total.fn,
            value: totalValue(bucket.totals[i]),
          })),
        }))
      : undefined;
    const totals: ListTotalValue[] | undefined = totalsRow
      ? ext.totals.map((total, i) => ({
          fn: total.fn,
          value: totalValue(totalsRow[`t${i}`] ?? null),
        }))
      : undefined;
    return { items, nextCursor, ...(groups ? { groups } : {}), ...(totals ? { totals } : {}) };
  }

  private assertFields(ext: ReturnType<typeof toListQueryExt>, ctx: ListSqlContext): void {
    for (const predicate of ext.filter) {
      if (predicate.kind === 'field') assertListField(predicate.field, ctx);
    }
    for (const sort of ext.sort) assertListField(sort.field, ctx);
    if (ext.group) assertListField(ext.group.field, ctx);
    for (const total of ext.totals) {
      if (total.fn !== 'count') assertListField(total.field, ctx);
    }
  }
}

function totalValue(raw: unknown): ListTotalValue['value'] {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'number' || typeof raw === 'string') return raw;
  return String(raw);
}
