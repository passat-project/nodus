import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  type AuthUser,
  type FolderListItem,
  type ListFoldersQuery,
  type ListGroupBucket,
  type ListResult,
  type ListSort,
  type ListTotalValue,
  toListQueryExt,
} from '@nodus/contracts';

import { decodeCursor, encodeCursor } from '../../core/pagination/cursor.util.js';
import {
  assertListField,
  buildStageFlagIndex,
  filterSql,
  type ListExtCursor,
  type ListSqlContext,
} from '../../core/lists/list-ext-sql.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../custom-fields/ports/custom-field-registry.port.js';
import { ProjectsService } from './projects.service.js';
import {
  folderListSqlContext,
  ProjectFoldersRepository,
  type FolderRow,
} from './project-folders.repository.js';

const extCursor = z.object({
  o: z.array(z.union([z.string(), z.number(), z.null()])),
  id: z.uuid(),
});

/**
 * Список папок проекта (#435): «+» → «Список» → папки с расширением —
 * фильтр по атрибутам вида, сортировка, группы и итоги по всем папкам
 * рамки проекта. Видимость — как у структуры: проект виден → видны все его
 * папки (секретный проект чужому — 404 без оракула); рамка projectId не
 * снимается.
 */
@Injectable()
export class ProjectFoldersService {
  constructor(
    private readonly repo: ProjectFoldersRepository,
    private readonly projects: ProjectsService,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
  ) {}

  async list(
    user: AuthUser,
    projectId: string,
    q: ListFoldersQuery,
  ): Promise<ListResult<FolderListItem>> {
    await this.projects.assertVisible(user, projectId);
    const ext = toListQueryExt(q);
    const defs = await this.customFields.definitions();
    const ctx = folderListSqlContext(new Map(defs.map((d) => [d.id, d])));
    this.assertFields(ext, ctx);
    // Предикаты этапа/типа/состояния у папок ложны (нет маршрута) —
    // индекс стадий пуст и не нужен.
    const stages = buildStageFlagIndex([]);
    const filter = filterSql(ext.filter, ctx, stages);

    const sorts: ListSort[] = ext.group
      ? [{ field: ext.group.field, dir: 'asc' }, ...ext.sort]
      : ext.sort;
    const cursor = q.cursor ? (decodeCursor(q.cursor, extCursor) as ListExtCursor) : undefined;

    const [page, groupsRow, totalsRow] = await Promise.all([
      this.repo.page(projectId, sorts, cursor, q.limit, ctx, filter),
      ext.group
        ? this.repo.groups(projectId, ext.group.field, ext.totals, ctx, filter)
        : Promise.resolve(null),
      ext.totals.length > 0
        ? this.repo.totals(projectId, ext.totals, ctx, filter)
        : Promise.resolve(null),
    ]);

    const hasMore = page.ids.length > q.limit;
    const ids = page.ids.slice(0, q.limit);
    const values = page.sortValues.slice(0, q.limit);
    const last = ids.length - 1;
    const nextCursor =
      hasMore && last >= 0 ? encodeCursor({ o: values[last], id: ids[last]! }) : null;

    const byId = new Map((await this.repo.rowsByIds(ids)).map((row) => [row.id, row]));
    const items: FolderListItem[] = ids
      .map((id) => byId.get(id))
      .filter((row): row is FolderRow => row !== undefined)
      .map((row) => ({
        id: row.id,
        projectId: row.projectId,
        parentId: row.parentId,
        kindId: row.kindId,
        name: row.name,
        code: row.code,
        customFields: (row.customFields ?? {}) as FolderListItem['customFields'],
        createdAt: row.createdAt.toISOString(),
      }));

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

/** Значение итога в DTO: float8/int — числа, текст/момент — строкой. */
function totalValue(raw: unknown): ListTotalValue['value'] {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'number' || typeof raw === 'string') return raw;
  return String(raw);
}
