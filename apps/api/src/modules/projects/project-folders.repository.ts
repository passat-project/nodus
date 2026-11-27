import { Injectable } from '@nestjs/common';
import type { ListField, ListSort, ListTotal } from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../core/database/prisma.service.js';
import {
  fieldSql,
  groupKeySql,
  keysetAfterSql,
  orderSql,
  totalSelectSql,
  type ListExtCursor,
  type ListSqlContext,
} from '../../core/lists/list-ext-sql.js';

/** SQL-контекст папок проекта для билдеров core/lists: системных предикатов
 * (тип/стадия/состояние) у папок нет — field/stage/system_state ложны. */
export function folderListSqlContext(defs: ListSqlContext['defs']): ListSqlContext {
  const ts = (expr: Prisma.Sql) => ({ expr, cast: 'timestamptz' as const });
  const text = (expr: Prisma.Sql) => ({ expr, cast: 'text' as const });
  return {
    entity: 'folder',
    defs,
    systemExpr: {
      name: text(Prisma.sql`n.name`),
      kind: text(Prisma.sql`n.kind_id`),
      createdAt: ts(Prisma.sql`n.created_at`),
    },
    cfColumn: Prisma.sql`n.custom_fields`,
    idExpr: Prisma.sql`n.id`,
    systemPredicates: {},
  };
}

/**
 * Ext-чтения папок проекта (#435): список папок как вкладка-список с тем же
 * расширением (фильтр по атрибутам вида, сортировка, группы, итоги).
 * Видимость — проект целиком (проверяет сервис); рамка `n.project_id`
 * не снимается.
 */
@Injectable()
export class ProjectFoldersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Страница ключей: id + значения сортировок (+1 — признак следующей). */
  async page(
    projectId: string,
    sorts: readonly ListSort[],
    cursor: ListExtCursor | undefined,
    limit: number,
    ctx: ListSqlContext,
    filter: Prisma.Sql,
  ): Promise<{ ids: string[]; sortValues: (string | number | null)[][] }> {
    const order = orderSql(sorts, ctx);
    const keyset = cursor ? keysetAfterSql(cursor, sorts, ctx) : null;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT n.id AS id${
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
      FROM project_nodes n
      WHERE n.project_id = ${projectId}::uuid AND ${filter}${
        keyset ? Prisma.sql` AND ${keyset}` : Prisma.empty
      }
      ORDER BY ${order}
      LIMIT ${limit + 1}::int`;
    return {
      ids: rows.map((row) => String(row.id)),
      sortValues: rows.map((row) => sorts.map((_, i) => normalize(row[`s${i}`]))),
    };
  }

  /** Итоги по всем папкам проекта (одной строкой). */
  async totals(
    projectId: string,
    totals: readonly ListTotal[],
    ctx: ListSqlContext,
    filter: Prisma.Sql,
  ): Promise<Record<string, unknown>> {
    const parts = totals.map(
      (total, i) => Prisma.sql`(${totalSelectSql(total, ctx)}) AS ${Prisma.raw(`"t${i}"`)}`,
    );
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT count(*)::int AS count${
        parts.length > 0 ? Prisma.sql`, ${Prisma.join(parts, ', ')}` : Prisma.empty
      }
      FROM project_nodes n
      WHERE n.project_id = ${projectId}::uuid AND ${filter}`;
    return rows[0] ?? { count: 0 };
  }

  /** Группы папок: ключ, счётчик, агрегаты (порядок — ключ). */
  async groups(
    projectId: string,
    groupField: ListField,
    totals: readonly ListTotal[],
    ctx: ListSqlContext,
    filter: Prisma.Sql,
  ): Promise<{ key: string | number | null; count: number; totals: unknown[] }[]> {
    const key = groupKeySql(groupField, ctx);
    const parts = totals.map(
      (total, i) => Prisma.sql`(${totalSelectSql(total, ctx)}) AS ${Prisma.raw(`"t${i}"`)}`,
    );
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT (${key}) AS key, count(*)::int AS count${
        parts.length > 0 ? Prisma.sql`, ${Prisma.join(parts, ', ')}` : Prisma.empty
      }
      FROM project_nodes n
      WHERE n.project_id = ${projectId}::uuid AND ${filter}
      GROUP BY 1
      ORDER BY 1 NULLS LAST`;
    return rows.map((row) => ({
      key: normalize(row.key),
      count: Number(row.count ?? 0),
      totals: totals.map((_, i) => row[`t${i}`] ?? null),
    }));
  }

  /** Строки папок по id (гидратация DTO; порядок выравнивает сервис). */
  rowsByIds(ids: readonly string[]): Promise<FolderRow[]> {
    return this.prisma.projectNode.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        projectId: true,
        parentId: true,
        kindId: true,
        name: true,
        code: true,
        customFields: true,
        order: true,
        createdAt: true,
      },
    });
  }
}

/** Сырая строка папки (createdAt — Date, customFields — JsonValue): DTO
 * собирает сервис ( FolderListItem — ISO-строки). */
export interface FolderRow {
  id: string;
  projectId: string;
  parentId: string | null;
  kindId: string;
  name: string;
  code: string | null;
  customFields: Prisma.JsonValue;
  order: string;
  createdAt: Date;
}

function normalize(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
