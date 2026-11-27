import { Inject, Injectable } from '@nestjs/common';
import {
  listsStrings,
  type AuthUser,
  type CustomFieldDefinition,
  type ListEntity,
  type ListSort,
} from '@nodus/contracts';

import { formatCfValue } from '../../../core/lists/list-cf-format.js';
import {
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
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import { ViewerResolver, visibleTasksSql } from '../access/task-visibility.js';
import { TaskDtoMapper } from '../tasks/task-dto.mapper.js';
import { TasksExtRepository, taskListSqlContext } from '../tasks/tasks-ext.repository.js';
import type {
  ListExportQuery,
  ListExportRow,
  ListExportSource,
} from '../../views/list-export-source.port.js';

/** Порция строк между разрешениями имён (один батч ссылок на порцию). */
const CHUNK = 500;

/**
 * Источник строк выгрузки CSV «задачи» (#435): та же видимость/рамка/фильтр/
 * сортировка, что у ext-списка (visibleTasksSql + фильтр #635). Системные
 * колонки разрешаются в показательные значения (имена статусов, типов, людей,
 * проектов, папок); атрибуты — реестр (refsMany) и общий форматер значений.
 */
@Injectable()
export class TaskListExportSource implements ListExportSource {
  constructor(
    private readonly repo: TasksExtRepository,
    private readonly viewers: ViewerResolver,
    private readonly mapper: TaskDtoMapper,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
  ) {}

  supports(entity: ListEntity): boolean {
    return entity === 'task';
  }

  async count(actor: AuthUser, query: ListExportQuery): Promise<number> {
    const { where } = await this.exportWhere(actor, query);
    return this.repo.count(where);
  }

  async *rows(
    actor: AuthUser,
    query: ListExportQuery,
    chunk = CHUNK,
  ): AsyncGenerator<ListExportRow, void, void> {
    const sorts: ListSort[] =
      query.sort.length > 0 ? query.sort : [{ field: 'number', dir: 'desc' }];
    const { where, ctx, defOf } = await this.exportWhere(actor, query);
    let cursor: ListExtCursor | undefined;
    do {
      const page = await this.repo.exportPage(where, sorts, cursor, chunk, ctx);
      if (page.rows.length === 0) break;
      yield* await this.hydrateChunk(actor, page.rows, defOf);
      cursor = page.next ?? undefined;
    } while (cursor);
  }

  /** WHERE выгрузки: видимость «всё видимое мне» + неснимаемая рамка (проект
   * или тип) + предикаты фильтра (#635). */
  private async exportWhere(
    actor: AuthUser,
    query: ListExportQuery,
  ): Promise<{
    where: Prisma.Sql;
    ctx: ListSqlContext;
    defOf: Map<string, CustomFieldDefinition>;
  }> {
    const viewer = await this.viewers.resolve(actor);
    const [defs, stageFlags] = await Promise.all([
      this.customFields.definitions(),
      this.catalog.liveStageFlags('task'),
    ]);
    const defOf = new Map(defs.map((d) => [d.id, d]));
    const ctx = taskListSqlContext(defOf);
    const parts: Prisma.Sql[] = [visibleTasksSql(viewer, 'all')];
    if (query.scope.kind === 'project') {
      parts.push(Prisma.sql`t.project_id = ${query.scope.projectId}::uuid`);
    }
    if (query.scope.kind === 'type_default') {
      parts.push(Prisma.sql`t.type_id = ${query.scope.typeId}::uuid`);
    }
    if (query.filter.length > 0) {
      parts.push(filterSql(query.filter, ctx, buildStageFlagIndex(stageFlags)));
    }
    return { where: Prisma.join(parts, ' AND '), ctx, defOf };
  }

  /** Имена ссылок одним батчем на порцию; значения — показательные. */
  private async *hydrateChunk(
    actor: AuthUser,
    rows: Awaited<ReturnType<TasksExtRepository['exportPage']>>['rows'],
    defOf: ReadonlyMap<string, CustomFieldDefinition>,
  ): AsyncGenerator<ListExportRow, void, void> {
    const [stages, types, users, projects, nodes, cfRefs] = await Promise.all([
      this.catalog.stagesByIds([...new Set(rows.map((r) => r.stageId))]),
      this.catalog.typeRefs([...new Set(rows.map((r) => r.typeId))]),
      this.mapper.refs([
        ...new Set(rows.flatMap((r) => [r.assigneeId, ...(r.decidedBy ? [r.decidedBy] : [])])),
      ]),
      this.projects.refsFor(
        actor,
        rows.map((r) => r.projectId).filter((id): id is string => id !== null),
      ),
      this.projects.numberContext(
        [],
        rows.map((r) => r.nodeId).filter((id): id is string => id !== null),
      ),
      this.customFields.refsMany(
        rows.map((r) => (r.customFields ?? {}) as Record<string, never>),
        actor,
      ),
    ]);
    const stageNames = new Map(stages.map((s) => [s.id, s.name]));
    const typeNames = new Map(types.map((t) => [t.id, t.name]));
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const nodeNames = new Map(nodes.nodes.map((n) => [n.id, n.name]));
    const refNames = new Map<string, string | null>(cfRefs.map((ref) => [ref.id, ref.name]));

    for (const row of rows) {
      const values: Record<string, string | number | null> = {
        number: `ПП-${row.number}`,
        title: row.title,
        stage: stageNames.get(row.stageId) ?? null,
        deadline: row.deadline?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        assignee: row.assigneeId ? (users.get(row.assigneeId)?.displayName ?? null) : null,
        type: typeNames.get(row.typeId) ?? null,
        project: row.projectId ? (projectNames.get(row.projectId) ?? null) : null,
        folder: row.nodeId ? (nodeNames.get(row.nodeId) ?? null) : null,
        decidedBy: row.decidedBy ? (users.get(row.decidedBy)?.displayName ?? null) : null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
      };
      const raw = (row.customFields ?? {}) as Record<string, unknown>;
      for (const [fieldId, def] of defOf) {
        values[`cf.${fieldId}`] = formatCfValue(def, raw[fieldId], refNames, BOOL_LABELS);
      }
      yield { id: row.id, values };
    }
  }
}

const BOOL_LABELS = listsStrings.boolLabels;
