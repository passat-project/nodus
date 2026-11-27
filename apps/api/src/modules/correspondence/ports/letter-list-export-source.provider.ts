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
  COUNTERPARTY_READER,
  type CounterpartyReader,
} from '../../crm/ports/counterparty-reader.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import type {
  ListExportQuery,
  ListExportRow,
  ListExportSource,
} from '../../views/list-export-source.port.js';
import { LettersExtRepository, letterListSqlContext } from '../letters/letters-ext.repository.js';
import { canViewConfidential } from '../access/letter-access.js';

/** Порция строк между разрешениями имён. */
const CHUNK = 500;

/**
 * Источник строк выгрузки CSV «письма» (#435): та же видимость ящика и
 * конфиденциальности, рамка и фильтр, что у ext-списка писем. Корреспондент —
 * имя из справочника, адресат — профиль, статус/тип — каталог «Процессов».
 */
@Injectable()
export class LetterListExportSource implements ListExportSource {
  constructor(
    private readonly repo: LettersExtRepository,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
  ) {}

  supports(entity: ListEntity): boolean {
    return entity === 'letter';
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
      query.sort.length > 0 ? query.sort : [{ field: 'createdAt', dir: 'desc' }];
    const { where, ctx, defOf } = await this.exportWhere(actor, query);
    let cursor: ListExtCursor | undefined;
    do {
      const page = await this.repo.exportPage(where, sorts, cursor, chunk, ctx);
      if (page.rows.length === 0) break;
      yield* await this.hydrateChunk(actor, page.rows, defOf);
      cursor = page.next ?? undefined;
    } while (cursor);
  }

  /** WHERE выгрузки: зарегистрированные обоих направлений (общий список),
   * гейт конфиденциальности + неснимаемая рамка + фильтр. */
  private async exportWhere(
    actor: AuthUser,
    query: ListExportQuery,
  ): Promise<{
    where: Prisma.Sql;
    ctx: ListSqlContext;
    defOf: Map<string, CustomFieldDefinition>;
  }> {
    const [defs, stageFlags] = await Promise.all([
      this.customFields.definitions(),
      this.catalog.liveStageFlags('letter'),
    ]);
    const defOf = new Map(defs.map((d) => [d.id, d]));
    const ctx = letterListSqlContext(defOf);
    const parts: Prisma.Sql[] = this.repo.frameSql(
      {} as never,
      actor.id,
      canViewConfidential(actor),
    );
    if (query.scope.kind === 'project') {
      parts.push(Prisma.sql`l.project_id = ${query.scope.projectId}::uuid`);
    }
    if (query.scope.kind === 'type_default') {
      parts.push(Prisma.sql`l.type_id = ${query.scope.typeId}::uuid`);
    }
    if (query.filter.length > 0) {
      parts.push(filterSql(query.filter, ctx, buildStageFlagIndex(stageFlags)));
    }
    return { where: Prisma.join(parts, ' AND '), ctx, defOf };
  }

  private async *hydrateChunk(
    actor: AuthUser,
    rows: Awaited<ReturnType<LettersExtRepository['exportPage']>>['rows'],
    defOf: ReadonlyMap<string, CustomFieldDefinition>,
  ): AsyncGenerator<ListExportRow, void, void> {
    const [stages, types, counterparties, users, projects, cfRefs] = await Promise.all([
      this.catalog.stagesByIds([...new Set(rows.map((r) => r.stageId))]),
      this.catalog.typeRefs([...new Set(rows.map((r) => r.typeId))]),
      this.counterparties.refs(
        rows.map((r) => r.counterpartyId).filter((id): id is string => id !== null),
      ),
      this.profiles.findRefs(
        rows.map((r) => r.addresseeId).filter((id): id is string => id !== null),
      ),
      this.projects.refsFor(
        actor,
        rows.map((r) => r.projectId).filter((id): id is string => id !== null),
      ),
      this.customFields.refsMany(
        rows.map((r) => (r.customFields ?? {}) as Record<string, never>),
        actor,
      ),
    ]);
    const stageNames = new Map(stages.map((s) => [s.id, s.name]));
    const typeNames = new Map(types.map((t) => [t.id, t.name]));
    const counterpartyNames = new Map(counterparties.map((c) => [c.id, c.name]));
    const userNames = new Map(users.map((u) => [u.id, u.displayName]));
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const refNames = new Map<string, string | null>(cfRefs.map((ref) => [ref.id, ref.name]));

    for (const row of rows) {
      const values: Record<string, string | number | null> = {
        regNumber: row.regNumber,
        correspondent: row.counterpartyId
          ? (counterpartyNames.get(row.counterpartyId) ?? null)
          : null,
        sentAt: row.theirDate?.toISOString().slice(0, 10) ?? null,
        createdAt: row.createdAt.toISOString(),
        assignee: row.addresseeId ? (userNames.get(row.addresseeId) ?? null) : null,
        type: typeNames.get(row.typeId) ?? null,
        project: row.projectId ? (projectNames.get(row.projectId) ?? null) : null,
        stage: stageNames.get(row.stageId) ?? null,
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
