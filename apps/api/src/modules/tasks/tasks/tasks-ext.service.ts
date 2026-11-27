import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  type AuthUser,
  type ListFilter,
  type ListGroupBucket,
  type ListResult,
  type ListSort,
  type ListTasksQuery,
  type ListTotalValue,
  type TaskListItem,
  toListQueryExt,
} from '@nodus/contracts';

import { encodeCursor, decodeCursor } from '../../../core/pagination/cursor.util.js';
import {
  assertListField,
  buildStageFlagIndex,
  filterSql,
  type ListExtCursor,
  type ListSqlContext,
} from '../../../core/lists/list-ext-sql.js';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { type Viewer, ViewerResolver } from '../access/task-visibility.js';
import { visibleTasksSql } from '../access/task-visibility.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { TaskDtoMapper } from './task-dto.mapper.js';
import { withFormulaState } from './task-formula-state.js';
import type { TaskListRow } from './task-row.js';
import { TasksExtRepository, taskListSqlContext } from './tasks-ext.repository.js';

const extCursor = z.object({
  o: z.array(z.union([z.string(), z.number(), z.null()])),
  id: z.uuid(),
});

/**
 * Список задач с расширением (#435): фильтр — предикаты общей выборки #635,
 * сортировка по любой колонке (включая атрибуты JSONB), группы и итоги по
 * всей видимой выборке. Видимость ОДНА — SQL-эквивалент visibleTasksWhere
 * (visibleTasksSql); рамка проекта (projectId запроса) не снимается.
 */
@Injectable()
export class TasksExtService {
  constructor(
    private readonly repo: TasksExtRepository,
    private readonly viewers: ViewerResolver,
    private readonly mapper: TaskDtoMapper,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(FORMULA_CELLS) private readonly formulas: FormulaCells,
  ) {}

  async list(user: AuthUser, q: ListTasksQuery): Promise<ListResult<TaskListItem>> {
    const ext = toListQueryExt(q);
    const viewer = await this.viewers.resolve(user);
    const [defs, stageFlags] = await Promise.all([
      this.customFields.definitions(),
      this.catalog.liveStageFlags('task'),
    ]);
    const ctx = taskListSqlContext(new Map(defs.map((d) => [d.id, d])));
    this.assertFields(ext, ctx);

    const stages = buildStageFlagIndex(stageFlags);
    // Как в TasksQueryService.list: роль решающего требует scope all.
    const scope = q.role === 'decider' ? 'all' : q.scope;
    const whereParts: Prisma.Sql[] = [visibleTasksSql(viewer, scope)];
    if (q.role === 'decider' && viewer.deciderTaskIds && viewer.deciderTaskIds.length > 0) {
      const ids = Prisma.join(
        viewer.deciderTaskIds.map((id) => Prisma.sql`${id}::uuid`),
        ', ',
      );
      whereParts.push(Prisma.sql`(t.id IN (${ids}))`);
    }
    whereParts.push(...this.repo.feedFiltersSql(q, user.id, new Date()));
    if (ext.filter.length > 0) whereParts.push(filterSql(ext.filter, ctx, stages));
    const where = Prisma.join(whereParts, ' AND ');

    // Группировка задаёт неявную первую сортировку — догрузка страниц не
    // рушит состав групп (контракт listGroupSchema).
    const sorts: ListSort[] = ext.group
      ? [{ field: ext.group.field, dir: 'asc' }, ...ext.sort]
      : ext.sort;
    const cursor = q.cursor ? (decodeCursor(q.cursor, extCursor) as ListExtCursor) : undefined;

    const [page, groupsRow, totalsRow] = await Promise.all([
      this.repo.page(where, sorts, cursor, q.limit, ctx),
      ext.group ? this.repo.groups(where, ext.group.field, ext.totals, ctx) : Promise.resolve(null),
      ext.totals.length > 0 ? this.repo.totals(where, ext.totals, ctx) : Promise.resolve(null),
    ]);

    const hasMore = page.ids.length > q.limit;
    const ids = page.ids.slice(0, q.limit);
    const values = page.sortValues.slice(0, q.limit);
    const last = ids.length - 1;
    const nextCursor =
      hasMore && last >= 0 ? encodeCursor({ o: values[last], id: ids[last]! }) : null;

    const items = await this.hydrate(user, viewer, ids, page.decided);
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

  /** WHERE выгрузки CSV (#435): та же видимость (журнал — «всё видимое
   * мне», scope all) + неснимаемая рамка проекта + фильтр вида. */
  async exportWhere(
    user: AuthUser,
    scope:
      | { kind: 'journal' }
      | { kind: 'project'; projectId: string }
      | { kind: 'type_default'; typeId: string },
    filter: ListFilter,
  ): Promise<{ where: Prisma.Sql; ctx: ListSqlContext }> {
    const viewer = await this.viewers.resolve(user);
    const [defs, stageFlags] = await Promise.all([
      this.customFields.definitions(),
      this.catalog.liveStageFlags('task'),
    ]);
    const ctx = taskListSqlContext(new Map(defs.map((d) => [d.id, d])));
    const stages = buildStageFlagIndex(stageFlags);
    const parts: Prisma.Sql[] = [visibleTasksSql(viewer, 'all')];
    if (scope.kind === 'project') {
      parts.push(Prisma.sql`t.project_id = ${scope.projectId}::uuid`);
    }
    if (scope.kind === 'type_default') {
      // Список типа по умолчанию — записи этого типа (рамка типа).
      parts.push(Prisma.sql`t.type_id = ${scope.typeId}::uuid`);
    }
    if (filter.length > 0) parts.push(filterSql(filter, ctx, stages));
    return { where: Prisma.join(parts, ' AND '), ctx };
  }

  /** Поле запроса применимо к задачам (опечатка/чужая сущность — 422). */
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

  /** Строки страницы: полные TaskListRow по id (в порядке страницы) + DTO с
   * формульным состоянием и колонками решения. */
  private async hydrate(
    user: AuthUser,
    viewer: Viewer,
    ids: readonly string[],
    decided: ReadonlyMap<string, { by: string | null; at: Date | null }>,
  ): Promise<TaskListItem[]> {
    if (ids.length === 0) return [];
    const rows = await this.repo.rowsByIds(ids, viewer.id);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((row): row is TaskListRow => row !== undefined);
    let items = await this.mapper.toListItems(ordered, undefined, user);
    items = await withFormulaState(this.formulas, items, {
      registry: this.customFields,
      actor: user,
    });
    // «Кто решил» — ссылки актёров одним батчем; момент — ISO.
    const actorIds = [
      ...new Set(
        items
          .map((item) => decided.get(item.id)?.by)
          .filter((id): id is string => id !== null && id !== undefined),
      ),
    ];
    const refs = await this.mapper.refs(actorIds);
    return items.map((item) => {
      const decision = decided.get(item.id);
      return {
        ...item,
        decidedBy: decision?.by ? (refs.get(decision.by) ?? null) : null,
        decidedAt: decision?.at ? decision.at.toISOString() : null,
      };
    });
  }
}

/** Значение итога в DTO: float8/int — числа, текст/момент — строкой, null —
 * null (тип значения следует типу поля, как у ключа группы). */
function totalValue(raw: unknown): ListTotalValue['value'] {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'number' || typeof raw === 'string') return raw;
  return String(raw);
}
