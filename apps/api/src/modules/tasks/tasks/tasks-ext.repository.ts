import { Injectable } from '@nestjs/common';
import {
  statesOfPhase,
  type ListField,
  type ListSort,
  type ListTasksQuery,
  type ListTotal,
} from '@nodus/contracts';

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
import { taskListInclude, type TaskListRow } from './task-row.js';

/** «Кто решил/когда» (#435): последнее решение человека по журналу переходов
 * (общий журнал ADR-0024 п.4 — plain UUID по конструктору сущностей, здесь
 * только читается). LATERAL — один визит на строку страницы. */
const DECIDED_JOIN = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT tr.actor_id AS decided_by, tr.created_at AS decided_at
    FROM transition_records tr
    WHERE tr.entity_kind = 'task' AND tr.entity_id = t.id AND tr.actor_id IS NOT NULL
    ORDER BY tr.created_at DESC, tr.id DESC
    LIMIT 1
  ) d ON true`;

/** SQL-контекст задач для билдеров core/lists: системные поля tasks (+ d.* —
 * колонки решения из DECIDED_JOIN), атрибуты — t.custom_fields. */
export function taskListSqlContext(defs: ListSqlContext['defs']): ListSqlContext {
  const ts = (expr: Prisma.Sql) => ({ expr, cast: 'timestamptz' as const });
  const text = (expr: Prisma.Sql) => ({ expr, cast: 'text' as const });
  return {
    entity: 'task',
    defs,
    systemExpr: {
      number: { expr: Prisma.sql`t.number`, cast: 'numeric' },
      title: text(Prisma.sql`t.title`),
      stage: text(Prisma.sql`t.stage_id`),
      deadline: ts(Prisma.sql`t.deadline`),
      createdAt: ts(Prisma.sql`t.created_at`),
      assignee: text(Prisma.sql`t.assignee_id`),
      type: text(Prisma.sql`t.type_id`),
      project: text(Prisma.sql`t.project_id`),
      folder: text(Prisma.sql`t.node_id`),
      decidedBy: text(Prisma.sql`d.decided_by`),
      decidedAt: ts(Prisma.sql`d.decided_at`),
    },
    cfColumn: Prisma.sql`t.custom_fields`,
    idExpr: Prisma.sql`t.id`,
    systemPredicates: {
      typeId: Prisma.sql`t.type_id`,
      stageId: Prisma.sql`t.stage_id`,
      systemState: Prisma.sql`t.system_state`,
    },
  };
}

export interface TaskExtPage {
  ids: string[];
  /** Значения полей сортировки построчно (порядок sorts) — для курсора. */
  sortValues: (string | number | null)[][];
  /** Последнее решение: taskId → (актёр, момент). */
  decided: Map<string, { by: string | null; at: Date | null }>;
}

/**
 * Ext-чтения задач (#435): страница/группы/итоги сырым SQL поверх той же
 * видимости (visibleTasksSql) — Prisma не сортирует по JSONB-атрибутам
 * (research 27.11). WHERE собирает сервис; репозиторий исполняет.
 */
@Injectable()
export class TasksExtRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Фильтры фида поверх видимости — SQL-эквивалент feedFilters того же
   * запроса (роль/стадия/проект/исполнитель/родитель/тип/просрочка/поиск). */
  feedFiltersSql(q: ListTasksQuery, me: string, now: Date): Prisma.Sql[] {
    const and: Prisma.Sql[] = [];
    if (q.role === 'assignee') and.push(Prisma.sql`t.assignee_id = ${me}::uuid`);
    if (q.role === 'creator') and.push(Prisma.sql`t.creator_id = ${me}::uuid`);
    if (q.role === 'coexecutor' || q.role === 'observer') {
      and.push(
        Prisma.sql`EXISTS (
          SELECT 1 FROM task_participants tp
          WHERE tp.task_id = t.id AND tp.user_id = ${me}::uuid AND tp.role = ${q.role}::text
        )`,
      );
    }
    if (q.stageId) and.push(Prisma.sql`t.stage_id = ${q.stageId}::uuid`);
    if (q.projectId) and.push(Prisma.sql`t.project_id = ${q.projectId}::uuid`);
    if (q.assigneeId) and.push(Prisma.sql`t.assignee_id = ${q.assigneeId}::uuid`);
    if (q.parentId) and.push(Prisma.sql`t.parent_id = ${q.parentId}::uuid`);
    if (q.typeId) and.push(Prisma.sql`t.type_id = ${q.typeId}::uuid`);
    if (q.overdue) {
      const open = Prisma.join(
        statesOfPhase('open').map((state) => Prisma.sql`${state}::text`),
        ', ',
      );
      and.push(Prisma.sql`(t.deadline < ${now}::timestamptz AND t.system_state IN (${open}))`);
    }
    if (q.search) {
      const needle = `%${escapeLikePattern(q.search)}%`;
      const n = Number(q.search.replace(/^ПП-/i, ''));
      and.push(
        Number.isSafeInteger(n) && n > 0
          ? Prisma.sql`(t.title ILIKE ${needle} OR t.number = ${n}::int)`
          : Prisma.sql`t.title ILIKE ${needle}`,
      );
    }
    return and;
  }

  /** Страница ключей: id + значения сортировок + решение, +1 строка — признак
   * следующей страницы (курсор). Значения сортировок алиасятся s0..sN. */
  async page(
    where: Prisma.Sql,
    sorts: readonly ListSort[],
    cursor: ListExtCursor | undefined,
    limit: number,
    ctx: ListSqlContext,
  ): Promise<TaskExtPage> {
    const order = orderSql(sorts, ctx);
    const keyset = cursor ? keysetAfterSql(cursor, sorts, ctx) : null;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT t.id AS id, d.decided_by AS decided_by, d.decided_at AS decided_at${
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
      FROM tasks t
      ${DECIDED_JOIN}
      WHERE ${where}${keyset ? Prisma.sql` AND ${keyset}` : Prisma.empty}
      ORDER BY ${order}
      LIMIT ${limit + 1}::int`;
    const ids: string[] = [];
    const sortValues: (string | number | null)[][] = [];
    const decided = new Map<string, { by: string | null; at: Date | null }>();
    for (const row of rows) {
      ids.push(String(row.id));
      decided.set(String(row.id), {
        by: row.decided_by === null ? null : String(row.decided_by),
        at: row.decided_at instanceof Date ? row.decided_at : null,
      });
      sortValues.push(sorts.map((_, i) => normalizeSortValue(row[`s${i}`])));
    }
    return { ids, sortValues, decided };
  }

  /** Итоги по всей выборке: count + агрегаты (одной строкой, алиасы t0..tN). */
  async totals(
    where: Prisma.Sql,
    totals: readonly ListTotal[],
    ctx: ListSqlContext,
  ): Promise<Record<string, unknown>> {
    const parts = totals.map((total, i) => aliasAs(totalSelectSql(total, ctx), `t${i}`));
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT count(*)::int AS count${
        parts.length > 0 ? Prisma.sql`, ${Prisma.join(parts, ', ')}` : Prisma.empty
      }
      FROM tasks t
      WHERE ${where}`;
    return rows[0] ?? { count: 0 };
  }

  /** Группы по всей выборке: ключ, счётчик, агрегаты; порядок — по ключу
   * NULLS LAST (строки идут той же неявной сортировкой первым ключом). */
  async groups(
    where: Prisma.Sql,
    groupField: ListField,
    totals: readonly ListTotal[],
    ctx: ListSqlContext,
  ): Promise<{ key: string | number | null; count: number; totals: unknown[] }[]> {
    const key = groupKeySql(groupField, ctx);
    const parts = totals.map((total, i) => aliasAs(totalSelectSql(total, ctx), `t${i}`));
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT (${key}) AS key, count(*)::int AS count${
        parts.length > 0 ? Prisma.sql`, ${Prisma.join(parts, ', ')}` : Prisma.empty
      }
      FROM tasks t
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 NULLS LAST`;
    return rows.map((row) => ({
      key: normalizeGroupKey(row.key),
      count: Number(row.count ?? 0),
      totals: totals.map((_, i) => row[`t${i}`] ?? null),
    }));
  }

  /** Полные строки страницы по id (гидратация DTO; порядок выравнивает
   * сервис). Include — тот же, что у обычного списка. */
  rowsByIds(ids: readonly string[], viewerId: string): Promise<TaskListRow[]> {
    return this.prisma.task.findMany({
      where: { id: { in: [...ids] } },
      include: taskListInclude(viewerId),
    });
  }

  /** Страница выгрузки CSV (#435): сырые колонки строки + значения
   * сортировок для курсора; та же видимость/фильтр/сортировка, что у списка. */
  async exportPage(
    where: Prisma.Sql,
    sorts: readonly ListSort[],
    cursor: ListExtCursor | undefined,
    limit: number,
    ctx: ListSqlContext,
  ): Promise<{
    rows: {
      id: string;
      number: number;
      title: string;
      stageId: string;
      deadline: Date | null;
      createdAt: Date;
      assigneeId: string;
      typeId: string;
      projectId: string | null;
      nodeId: string | null;
      customFields: unknown;
      decidedBy: string | null;
      decidedAt: Date | null;
    }[];
    next: ListExtCursor | null;
  }> {
    const order = orderSql(sorts, ctx);
    const keyset = cursor ? keysetAfterSql(cursor, sorts, ctx) : null;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT t.id AS id, t.number AS number, t.title AS title, t.stage_id AS "stageId",
        t.deadline AS deadline, t.created_at AS "createdAt", t.assignee_id AS "assigneeId",
        t.type_id AS "typeId", t.project_id AS "projectId", t.node_id AS "nodeId",
        t.custom_fields AS "customFields", d.decided_by AS "decidedBy", d.decided_at AS "decidedAt"${
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
      FROM tasks t
      ${DECIDED_JOIN}
      WHERE ${where}${keyset ? Prisma.sql` AND ${keyset}` : Prisma.empty}
      ORDER BY ${order}
      LIMIT ${limit + 1}::int`;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = page[page.length - 1];
    return {
      rows: page.map((row) => ({
        id: String(row.id),
        number: Number(row.number),
        title: String(row.title),
        stageId: String(row.stageId),
        deadline: row.deadline instanceof Date ? row.deadline : null,
        createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt)),
        assigneeId: String(row.assigneeId),
        typeId: String(row.typeId),
        projectId: row.projectId === null ? null : String(row.projectId),
        nodeId: row.nodeId === null ? null : String(row.nodeId),
        customFields: row.customFields,
        decidedBy: row.decidedBy === null ? null : String(row.decidedBy),
        decidedAt: row.decidedAt instanceof Date ? row.decidedAt : null,
      })),
      next:
        hasMore && lastRow
          ? {
              o: sorts.map((_, i) => normalizeSortValue(lastRow[`s${i}`])),
              id: String(lastRow.id),
            }
          : null,
    };
  }

  /** Счёт строк той же выборкой (выбор синхронной/фоновой выгрузки, #435). */
  async count(where: Prisma.Sql): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM tasks t WHERE ${where}`;
    return Number(rows[0]?.count ?? 0);
  }
}

function aliasAs(expr: Prisma.Sql, alias: string): Prisma.Sql {
  return Prisma.sql`(${expr}) AS ${Prisma.raw(`"${alias}"`)}`;
}

/** Значение колонки сортировки → JSON-совместимое для курсора. */
function normalizeSortValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return Number(value);
  // numeric приходит строкой из pg-драйвера: оставляем строкой — курсор
  // сравнивает с тем же кастом ::numeric, строка параметра валидна.
  return String(value);
}

function normalizeGroupKey(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
