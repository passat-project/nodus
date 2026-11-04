import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';

const counterpartySelect = {
  id: true,
  shortName: true,
  fullName: true,
  unp: true,
  address: true,
  email: true,
  phone: true,
  customFields: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CounterpartyRow = Prisma.CounterpartyGetPayload<{ select: typeof counterpartySelect }>;

/** Позиция keyset-курсора реестра: порядок (short_name, id). */
export interface CounterpartyCursor {
  shortName: string;
  id: string;
}

export interface CounterpartyListFilter {
  search?: string;
  includeArchived: boolean;
}

/** Строка подсказки похожих (сырой SQL: pg_trgm `word_similarity`). */
export interface SimilarCounterpartyRow {
  id: string;
  shortName: string;
  fullName: string;
  unp: string | null;
  archivedAt: Date | null;
  unpMatch: boolean;
  score: number;
}

/** Счётчики связей контрагента (проекция `counterparty_usages` + контакты). */
export interface CounterpartyCounts {
  lettersCount: number;
  projectsCount: number;
  contactsCount: number;
}

/**
 * Экранирование спецсимволов LIKE (`%`, `_`, `\`) в поисковой строке:
 * Prisma `contains` их не экранирует, и «%» работал бы как «все записи»
 * (security-ревью #460). После экранирования — литералы.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (ch) => `\\${ch}`);
}

export interface CounterpartyWriteData {
  shortName: string;
  fullName: string;
  unp: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Единственная точка доступа к таблицам модуля crm: `counterparties` и
 * проекция `counterparty_usages` (контакты — `contacts.repository.ts`).
 * Prisma/SQL наружу из модуля не выходят (patterns.md).
 */
@Injectable()
export class CounterpartiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Страница реестра по (short_name, id) +1 строка — признак следующей. */
  async findPage(
    filter: CounterpartyListFilter,
    after: CounterpartyCursor | null,
    limit: number,
  ): Promise<CounterpartyRow[]> {
    const search = filter.search?.trim();
    const pattern = search ? escapeLike(search) : '';
    // Поиск по УНП включаем только при цифрах в запросе: название цифр не
    // содержит, лишнее условие лишь мешает планировщику (GIN-триграммы).
    const searchWhere: Prisma.CounterpartyWhereInput[] = search
      ? [
          { shortName: { contains: pattern, mode: 'insensitive' } },
          { fullName: { contains: pattern, mode: 'insensitive' } },
          ...(/\d/u.test(search) ? [{ unp: { contains: pattern } }] : []),
        ]
      : [];
    return this.prisma.counterparty.findMany({
      where: {
        ...(filter.includeArchived ? {} : { archivedAt: null }),
        ...(searchWhere.length > 0 ? { OR: searchWhere } : {}),
        ...(after
          ? {
              AND: [
                {
                  OR: [
                    { shortName: { gt: after.shortName } },
                    { shortName: after.shortName, id: { gt: after.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ shortName: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: counterpartySelect,
    });
  }

  findById(id: string, tx?: TransactionClient): Promise<CounterpartyRow | null> {
    const client = tx ?? this.prisma;
    return client.counterparty.findUnique({ where: { id }, select: counterpartySelect });
  }

  findByUnp(unp: string, tx?: TransactionClient): Promise<CounterpartyRow | null> {
    const client = tx ?? this.prisma;
    return client.counterparty.findUnique({ where: { unp }, select: counterpartySelect });
  }

  create(data: CounterpartyWriteData, tx: TransactionClient): Promise<CounterpartyRow> {
    return tx.counterparty.create({ data, select: counterpartySelect });
  }

  update(
    id: string,
    data: Partial<CounterpartyWriteData>,
    tx: TransactionClient,
  ): Promise<CounterpartyRow> {
    return tx.counterparty.update({ where: { id }, data, select: counterpartySelect });
  }

  async setArchivedAt(
    id: string,
    archivedAt: Date | null,
    tx: TransactionClient,
  ): Promise<CounterpartyRow> {
    return tx.counterparty.update({
      where: { id },
      data: { archivedAt },
      select: counterpartySelect,
    });
  }

  /** Счётчики связей пачкой по id страницы (без денормализации в карточке). */
  async countsByIds(
    ids: readonly string[],
  ): Promise<Map<string, Omit<CounterpartyCounts, 'contactsCount'>>> {
    const counts = new Map<string, { lettersCount: number; projectsCount: number }>();
    if (ids.length === 0) return counts;
    const rows = await this.prisma.counterpartyUsage.groupBy({
      by: ['counterpartyId', 'sourceKind'],
      where: { counterpartyId: { in: [...ids] } },
      _count: { _all: true },
    });
    for (const row of rows) {
      const current = counts.get(row.counterpartyId) ?? { lettersCount: 0, projectsCount: 0 };
      if (row.sourceKind === 'letter') current.lettersCount = row._count._all;
      if (row.sourceKind === 'project') current.projectsCount = row._count._all;
      counts.set(row.counterpartyId, current);
    }
    return counts;
  }

  /** Строки «письмо контрагента» страницы (#461, Р4): счётчик фильтруется
   *  правилом видимости писем — число совпадает со вкладкой «Письма». */
  async letterUsages(
    counterpartyIds: readonly string[],
  ): Promise<{ counterpartyId: string; sourceId: string }[]> {
    if (counterpartyIds.length === 0) return [];
    return this.prisma.counterpartyUsage.findMany({
      where: { counterpartyId: { in: [...counterpartyIds] }, sourceKind: 'letter' },
      select: { counterpartyId: true, sourceId: true },
    });
  }

  /** Есть ли ссылки из писем/проектов (удаление связанной записи запрещено). */
  async hasUsages(id: string): Promise<boolean> {
    const row = await this.prisma.counterpartyUsage.findFirst({
      where: { counterpartyId: id },
      select: { counterpartyId: true },
    });
    return row !== null;
  }

  /** Физическое удаление записи (связи предварительно проверены сервисом). */
  async deleteWithContacts(id: string, tx: TransactionClient): Promise<void> {
    await tx.contactPerson.deleteMany({ where: { counterpartyId: id } });
    await tx.counterparty.delete({ where: { id } });
  }

  /** Ссылки для DTO чужих модулей (включая архивных: история рендерится). */
  findRefs(ids: readonly string[]): Promise<{ id: string; shortName: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.counterparty.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, shortName: true },
    });
  }

  /** Id живых контрагентов по подстроке названия (#55, поиск писем). */
  async searchIds(query: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.counterparty.findMany({
      where: {
        archivedAt: null,
        OR: [
          { shortName: { contains: escapeLike(query), mode: 'insensitive' } },
          { fullName: { contains: escapeLike(query), mode: 'insensitive' } },
        ],
      },
      orderBy: [{ shortName: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Действующий контрагент для записи ссылки (корреспондент, заказчик). */
  findActiveRef(id: string): Promise<{ id: string; shortName: string } | null> {
    return this.prisma.counterparty.findFirst({
      where: { id, archivedAt: null },
      select: { id: true, shortName: true },
    });
  }

  /**
   * Подсказка похожих (pg_trgm): точный УНП + нечёткое сходство названия
   * (`word_similarity` — опечатки, кавычки, порядок слов). Только параметры
   * тегированного шаблона — никакой склейки SQL (security-канон).
   */
  findSimilar(input: {
    unp: string | null;
    name: string;
    threshold: number;
    limit: number;
  }): Promise<SimilarCounterpartyRow[]> {
    const { unp, name, threshold, limit } = input;
    return this.prisma.$queryRaw<SimilarCounterpartyRow[]>(Prisma.sql`
      WITH scored AS (
        SELECT id, short_name, full_name, unp, archived_at,
               GREATEST(
                 word_similarity(${name}, translate(lower(short_name), 'ё', 'е')),
                 word_similarity(${name}, translate(lower(full_name), 'ё', 'е'))
               ) AS score
        FROM counterparties
      )
      SELECT id, short_name AS "shortName", full_name AS "fullName", unp,
             archived_at AS "archivedAt",
             (unp IS NOT NULL AND unp = ${unp}) AS "unpMatch",
             score
      FROM scored
      WHERE (unp IS NOT NULL AND unp = ${unp})
         OR (${name} <> '' AND score >= ${threshold}::float8)
      ORDER BY "unpMatch" DESC, score DESC, short_name, id
      LIMIT ${limit}::int
    `);
  }
}
