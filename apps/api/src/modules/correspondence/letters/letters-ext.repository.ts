import { Injectable } from '@nestjs/common';
import type { ListField, ListLettersQuery, ListSort, ListTotal } from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import { escapeLikePattern } from '../../../core/database/like-pattern.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import {
  fieldSql,
  groupKeySql,
  keysetAfterSql,
  orderSql,
  totalSelectSql,
  type ListExtCursor,
  type ListSqlContext,
} from '../../../core/lists/list-ext-sql.js';

/** SQL-контекст писем для билдеров core/lists: системные поля letters,
 * атрибуты — l.custom_fields. `sentAt` — дата документа корреспондента
 * (their_date: когда отправлено входящее; у исходящего пусто). */
export function letterListSqlContext(defs: ListSqlContext['defs']): ListSqlContext {
  const ts = (expr: Prisma.Sql) => ({ expr, cast: 'timestamptz' as const });
  const text = (expr: Prisma.Sql) => ({ expr, cast: 'text' as const });
  return {
    entity: 'letter',
    defs,
    systemExpr: {
      regNumber: text(Prisma.sql`l.reg_number`),
      correspondent: text(Prisma.sql`l.counterparty_id`),
      sentAt: text(Prisma.sql`l.their_date::text`),
      createdAt: ts(Prisma.sql`l.created_at`),
      assignee: text(Prisma.sql`l.addressee_id`),
      type: text(Prisma.sql`l.type_id`),
      project: text(Prisma.sql`l.project_id`),
      stage: text(Prisma.sql`l.stage_id`),
    },
    cfColumn: Prisma.sql`l.custom_fields`,
    idExpr: Prisma.sql`l.id`,
    systemPredicates: {
      typeId: Prisma.sql`l.type_id`,
      stageId: Prisma.sql`l.stage_id`,
      systemState: Prisma.sql`l.system_state`,
    },
  };
}

/**
 * Ext-чтения писем (#435): страница/группы/итоги сырым SQL поверх той же
 * видимости, что у списков ящика (box + конфиденциальность #461 Р4).
 */
@Injectable()
export class LettersExtRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Ящик + конфиденциальность — SQL-эквивалент boxWhere и
   * confidentialityWhere списков писем (видимость одна, #461 Р4). */
  frameSql(q: ListLettersQuery, userId: string, canViewConfidential: boolean): Prisma.Sql[] {
    const and: Prisma.Sql[] = [Prisma.sql`l.deleted_at IS NULL`];
    switch (q.box) {
      case 'new':
        and.push(Prisma.sql`l.registered_at IS NULL`);
        break;
      case 'incoming':
        and.push(Prisma.sql`(l.registered_at IS NOT NULL AND l.direction = 'incoming')`);
        break;
      case 'outgoing':
        and.push(Prisma.sql`(l.registered_at IS NOT NULL AND l.direction = 'outgoing')`);
        break;
      default:
        and.push(Prisma.sql`l.registered_at IS NOT NULL`);
    }
    // «Новые» видит только канцелярия — конфиденциальный гейт не нужен
    // (как в LettersQueryService.list); вне круга зрителя строки не даются.
    if (q.box !== 'new' && !canViewConfidential) {
      and.push(Prisma.sql`(
        l.confidential = false
        OR l.registrar_id = ${userId}::uuid
        OR l.addressee_id = ${userId}::uuid
        OR EXISTS (
          SELECT 1 FROM letter_participants lp
          WHERE lp.letter_id = l.id AND lp.user_id = ${userId}::uuid
        )
      )`);
    }
    return and;
  }

  /** Поиск реестра: тема/рег.номер/номер корреспондента/приложенные номера +
   * контрагенты по подсказке (ids — результат counterparties.searchIds). */
  searchSql(search: string, counterpartyIds: readonly string[]): Prisma.Sql {
    const needle = `%${escapeLikePattern(search)}%`;
    const parts: Prisma.Sql[] = [
      Prisma.sql`l.subject ILIKE ${needle}`,
      Prisma.sql`l.reg_number ILIKE ${needle}`,
      Prisma.sql`l.their_number ILIKE ${needle}`,
      Prisma.sql`EXISTS (
        SELECT 1 FROM letter_attached_refs lar
        WHERE lar.letter_id = l.id AND lar.number ILIKE ${needle}
      )`,
    ];
    if (counterpartyIds.length > 0) {
      parts.push(
        Prisma.sql`l.counterparty_id = ANY(${Prisma.sql`ARRAY[${Prisma.join(
          counterpartyIds.map((id) => Prisma.sql`${id}::uuid`),
          ', ',
        )}]::uuid[]`})`,
      );
    }
    return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
  }

  /** Страница ключей: id + значения сортировок (+1 — признак следующей). */
  async page(
    where: Prisma.Sql,
    sorts: readonly ListSort[],
    cursor: ListExtCursor | undefined,
    limit: number,
    ctx: ListSqlContext,
  ): Promise<{ ids: string[]; sortValues: (string | number | null)[][] }> {
    const order = orderSql(sorts, ctx);
    const keyset = cursor ? keysetAfterSql(cursor, sorts, ctx) : null;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT l.id AS id${
        sorts.length > 0
          ? Prisma.sql`, ${Prisma.join(
              sorts.map(
                (sort, i) =>
                  Prisma.sql`(${fieldSql(sort.field, ctx).expr}) AS s${Prisma.raw(String(i))}`,
              ),
              ', ',
            )}`
          : Prisma.empty
      }
      FROM letters l
      WHERE ${where}${keyset ? Prisma.sql` AND ${keyset}` : Prisma.empty}
      ORDER BY ${order}
      LIMIT ${limit + 1}::int`;
    return {
      ids: rows.map((row) => String(row.id)),
      sortValues: rows.map((row) => sorts.map((_, i) => normalize(row[`s${i}`]))),
    };
  }

  /** Итоги по всей выборке (одной строкой, алиасы t0..tN). */
  async totals(
    where: Prisma.Sql,
    totals: readonly ListTotal[],
    ctx: ListSqlContext,
  ): Promise<Record<string, unknown>> {
    const parts = totals.map(
      (total, i) => Prisma.sql`(${totalSelectSql(total, ctx)}) AS ${Prisma.raw(`"t${i}"`)}`,
    );
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT count(*)::int AS count${
        parts.length > 0 ? Prisma.sql`, ${Prisma.join(parts, ', ')}` : Prisma.empty
      }
      FROM letters l
      WHERE ${where}`;
    return rows[0] ?? { count: 0 };
  }

  /** Группы по всей выборке: ключ, счётчик, агрегаты (порядок — ключ). */
  async groups(
    where: Prisma.Sql,
    groupField: ListField,
    totals: readonly ListTotal[],
    ctx: ListSqlContext,
  ): Promise<{ key: string | number | null; count: number; totals: unknown[] }[]> {
    const key = groupKeySql(groupField, ctx);
    const parts = totals.map(
      (total, i) => Prisma.sql`(${totalSelectSql(total, ctx)}) AS ${Prisma.raw(`"t${i}"`)}`,
    );
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT (${key}) AS key, count(*)::int AS count${
        parts.length > 0 ? Prisma.sql`, ${Prisma.join(parts, ', ')}` : Prisma.empty
      }
      FROM letters l
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 NULLS LAST`;
    return rows.map((row) => ({
      key: normalize(row.key),
      count: Number(row.count ?? 0),
      totals: totals.map((_, i) => row[`t${i}`] ?? null),
    }));
  }
}

function normalize(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
