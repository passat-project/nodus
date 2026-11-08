import { Inject, Injectable } from '@nestjs/common';
import { CORRESPONDENCE_EVENTS, type NumberHostKind } from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import type {
  NumberActor,
  NumberHostProvider,
  NumberHostRecord,
  NumberTarget,
} from '../../custom-fields/ports/number-host.port.js';
import { LETTER_VISIBILITY_READER, type LetterVisibilityReader } from './letter-visibility.port.js';

/**
 * Носитель номеров «письмо» (#630): место — проект письма, значения —
 * атрибуты письма и проекта; видимость — то же правило, что у реестра
 * (конфиденциальные письма видят участники и `correspondence.view_confidential`).
 */
@Injectable()
export class LetterNumberHostProvider implements NumberHostProvider {
  static readonly numberHostKinds: readonly NumberHostKind[] = ['letter'];
  readonly numberHostKinds = LetterNumberHostProvider.numberHostKinds;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LETTER_VISIBILITY_READER) private readonly visibility: LetterVisibilityReader,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    private readonly events: EventBus,
  ) {}

  async listHosts(
    tx: TransactionClient,
    actor: NumberActor,
    typeIds: readonly string[],
  ): Promise<NumberHostRecord[]> {
    if (typeIds.length === 0) return [];
    const rows = await tx.letter.findMany({
      where: { typeId: { in: [...new Set(typeIds)] }, deletedAt: null },
      select: this.select(),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return this.records(tx, actor, rows);
  }

  async findHost(
    tx: TransactionClient,
    actor: NumberActor,
    kind: NumberHostKind,
    id: string,
  ): Promise<NumberHostRecord | null> {
    if (kind !== 'letter') return null;
    const row = await tx.letter.findFirst({
      where: { id, deletedAt: null },
      select: this.select(),
    });
    if (!row) return null;
    const [record] = await this.records(tx, actor, [row]);
    return record?.visible ? record : null;
  }

  async writeNumber(
    tx: TransactionClient,
    kind: NumberHostKind,
    id: string,
    fieldId: string,
    display: string,
  ): Promise<void> {
    if (kind !== 'letter') return;
    const letter = await tx.letter.findUnique({
      where: { id },
      select: { id: true, customFields: true },
    });
    if (!letter) return;
    const next = { ...asValues(letter.customFields), [fieldId]: display };
    await tx.letter.update({ where: { id }, data: { customFields: next as never } });
    await this.events.emit(
      tx,
      CORRESPONDENCE_EVENTS.LETTER_UPDATED,
      {
        letterId: id,
        changes: [{ field: `cf.${fieldId}`, from: null, to: display }],
      },
      { aggregateType: 'letter', aggregateId: id },
    );
  }

  /** Письмо не бывает значением условия счёта (контракт `numberContainerSchema`). */
  async resolveRef(): Promise<null> {
    return null;
  }

  async countWithoutNumber(
    tx: TransactionClient,
    typeIds: readonly string[],
    fieldId: string,
  ): Promise<number> {
    const ids = [...new Set(typeIds)];
    if (ids.length === 0) return 0;
    const list = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM letters
      WHERE type_id IN (${list})
        AND deleted_at IS NULL
        AND (custom_fields->>${fieldId} IS NULL OR custom_fields->>${fieldId} = '')
    `);
    return rows[0]?.count ?? 0;
  }

  private select() {
    return {
      id: true,
      typeId: true,
      projectId: true,
      subject: true,
      customFields: true,
      createdAt: true,
    } as const;
  }

  private async records(
    tx: TransactionClient,
    actor: NumberActor,
    rows: readonly {
      id: string;
      typeId: string;
      projectId: string | null;
      subject: string | null;
      customFields: unknown;
      createdAt: Date;
    }[],
  ): Promise<NumberHostRecord[]> {
    if (rows.length === 0) return [];
    const visible = await this.visibility.visibleLetterIds(
      rows.map((row) => row.id),
      actor,
    );
    const projectIds = rows.flatMap((row) => (row.projectId ? [row.projectId] : []));
    const contexts = await this.projects.numberContext(projectIds, [], tx);
    const projectById = new Map(contexts.projects.map((project) => [project.id, project]));
    return rows.map((row) => {
      const project = row.projectId ? projectById.get(row.projectId) : undefined;
      const target: NumberTarget = {
        host: 'letter',
        typeId: row.typeId,
        folders: [],
        projectId: project?.id ?? null,
        portfolioId: project?.portfolioId ?? null,
        projectTypeId: project?.typeId ?? null,
        parentTaskId: null,
        sources: { self: asValues(row.customFields), project: project?.values ?? null },
      };
      return {
        kind: 'letter',
        id: row.id,
        name: row.subject ?? 'Письмо',
        typeId: row.typeId,
        order: row.createdAt.getTime(),
        visible: visible.has(row.id),
        target,
      };
    });
  }
}

function asValues(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}
