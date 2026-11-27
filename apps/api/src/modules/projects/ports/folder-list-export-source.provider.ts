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
import type {
  ListExportQuery,
  ListExportRow,
  ListExportSource,
} from '../../views/list-export-source.port.js';
import { NodeKindsRepository } from '../project-node-kinds.repository.js';
import { ProjectParticipantsRepository } from '../project-participants.repository.js';
import { assertProjectVisible } from '../project-members.access.js';
import { ProjectFoldersRepository, folderListSqlContext } from '../project-folders.repository.js';
import { ProjectsRepository } from '../projects.repository.js';

/** Порция строк между разрешениями имён. */
const CHUNK = 500;

/**
 * Источник строк выгрузки CSV «папки проекта» (#435): рамка проекта — путь
 * сущности (scope обязан быть project; проверяет сервис экспорта), видимость
 * проекта — как у структуры (секретный не-участнику — 404 без оракула).
 */
@Injectable()
export class FolderListExportSource implements ListExportSource {
  constructor(
    private readonly repo: ProjectFoldersRepository,
    private readonly kinds: NodeKindsRepository,
    private readonly projects: ProjectsRepository,
    private readonly participants: ProjectParticipantsRepository,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
  ) {}

  supports(entity: ListEntity): boolean {
    return entity === 'folder';
  }

  async count(actor: AuthUser, query: ListExportQuery): Promise<number> {
    if (query.scope.kind !== 'project') return 0;
    await assertProjectVisible(actor, query.scope.projectId, this.projects, this.participants);
    const { filter } = await this.context(query);
    return this.repo.count(query.scope.projectId, filter);
  }

  async *rows(
    actor: AuthUser,
    query: ListExportQuery,
    chunk = CHUNK,
  ): AsyncGenerator<ListExportRow, void, void> {
    if (query.scope.kind !== 'project') return;
    await assertProjectVisible(actor, query.scope.projectId, this.projects, this.participants);
    const sorts: ListSort[] = query.sort.length > 0 ? query.sort : [{ field: 'name', dir: 'asc' }];
    const { filter, ctx, defOf } = await this.context(query);
    let cursor: ListExtCursor | undefined;
    do {
      const page = await this.repo.exportPage(
        query.scope.projectId,
        sorts,
        cursor,
        chunk,
        ctx,
        filter,
      );
      if (page.rows.length === 0) break;
      yield* await this.hydrateChunk(actor, page.rows, defOf);
      cursor = page.next ?? undefined;
    } while (cursor);
  }

  private async context(query: ListExportQuery): Promise<{
    filter: Prisma.Sql;
    ctx: ListSqlContext;
    defOf: Map<string, CustomFieldDefinition>;
  }> {
    const defs = await this.customFields.definitions();
    const defOf = new Map(defs.map((d) => [d.id, d]));
    const ctx = folderListSqlContext(defOf);
    // Предикаты этапа/типа/состояния у папок ложны (индекс стадий пуст).
    const filter = filterSql(query.filter, ctx, buildStageFlagIndex([]));
    return { filter, ctx, defOf };
  }

  private async *hydrateChunk(
    actor: AuthUser,
    rows: Awaited<ReturnType<ProjectFoldersRepository['exportPage']>>['rows'],
    defOf: ReadonlyMap<string, CustomFieldDefinition>,
  ): AsyncGenerator<ListExportRow, void, void> {
    const [kinds, cfRefs] = await Promise.all([
      this.kinds.list(),
      this.customFields.refsMany(
        rows.map((r) => (r.customFields ?? {}) as Record<string, never>),
        actor,
      ),
    ]);
    const kindNames = new Map(kinds.map((k) => [k.id, k.name]));
    const refNames = new Map<string, string | null>(cfRefs.map((ref) => [ref.id, ref.name]));

    for (const row of rows) {
      const values: Record<string, string | number | null> = {
        name: row.name,
        kind: kindNames.get(row.kindId) ?? null,
        createdAt: row.createdAt.toISOString(),
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
