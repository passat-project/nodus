import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  LIST_SYSTEM_FIELDS_BY_ENTITY,
  LIST_VIEW_LIMITS,
  customFieldIdOfKey,
  listSystemFieldLabel,
  listsStrings,
  type AuthUser,
  type CreateListExportBody,
  type CreateListExportResult,
  type ListExportStatus,
  type ListSystemField,
} from '@nodus/contracts';

import { buildCsv } from '../../core/lists/list-csv.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { SignedUrlService } from '../../core/crypto/signed-url.service.js';
import { FILE_STORAGE, type FileStorage } from '../../core/ports/file-storage.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../custom-fields/ports/custom-field-registry.port.js';
import { ListExportsRepository } from './list-exports.repository.js';
import {
  LIST_EXPORT_SOURCE,
  type ListExportQuery,
  type ListExportSource,
} from './list-export-source.port.js';
import { ViewsExportQueue } from './views-export.queue.js';

/** Имя файла выгрузки: «Выгрузка (Задачи) 2026-11-27.csv». */
function exportFileName(entity: string): string {
  const label = listsStrings.listEntityLabels[entity as keyof typeof listsStrings.listEntityLabels];
  return `Выгрузка (${label ?? entity}) ${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * Выгрузка списка CSV (#435): «то же, что на экране» — та же видимость, рамка
 * scope, фильтр и сортировка через источник сущности. До csvSyncRows строк —
 * файл собирается в запросе (done + подписанная ссылка); больше — фоновая
 * очередь views-export (статус по exportId; права автора снапшотятся при
 * заказе — воркер считает видимость «как на экране», а не свои). Мутация
 * идемпотентна (Idempotency-Key): реплей возвращает первый результат.
 */
@Injectable()
export class ListExportService {
  constructor(
    @Inject(LIST_EXPORT_SOURCE) private readonly sources: readonly ListExportSource[],
    private readonly repo: ListExportsRepository,
    private readonly queue: ViewsExportQueue,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly signedUrls: SignedUrlService,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
  ) {}

  async create(user: AuthUser, body: CreateListExportBody): Promise<CreateListExportResult> {
    const source = this.sourceOf(body.entity);
    // Папки живут только в рамке проекта — журнал/тип для них не существуют.
    if (body.entity === 'folder' && body.scope.kind !== 'project') {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'Folder export requires project scope',
        {
          entity: body.entity,
          scope: body.scope.kind,
        },
      );
    }
    this.assertColumns(body);

    const query: ListExportQuery = {
      entity: body.entity,
      scope: body.scope,
      filter: body.filter,
      sort: body.sort,
    };
    const count = await source.count(user, query);
    if (count <= LIST_VIEW_LIMITS.csvSyncRows) {
      const { csv } = await this.build(user, query, body.columns);
      const fileId = await this.saveFile(user.id, csv, body.entity);
      return { status: 'done', fileId, url: this.signedUrls.fileContentUrl(fileId) };
    }
    const exportId = randomUUID();
    await this.repo.create({
      id: exportId,
      entity: body.entity,
      scope: body.scope as object,
      filter: body.filter as unknown[],
      sort: body.sort as unknown[],
      columns: body.columns as unknown[],
      actor: [...user.permissions],
      requestedBy: user.id,
    });
    await this.queue.enqueue(exportId);
    return { status: 'queued', exportId };
  }

  /** Статус фоновой выгрузки — только её автор (чужая — 404 без оракула). */
  async statusOf(user: AuthUser, exportId: string): Promise<ListExportStatus> {
    const row = await this.repo.findById(exportId);
    if (!row || row.requestedBy !== user.id) {
      throw DomainException.notFound('List export not found');
    }
    switch (row.status) {
      case 'done':
        return {
          status: 'done',
          fileId: row.fileId!,
          url: this.signedUrls.fileContentUrl(row.fileId!),
        };
      case 'failed':
        return { status: 'failed', error: row.error ?? 'export failed' };
      case 'running':
        return { status: 'running' };
      default:
        return { status: 'queued' };
    }
  }

  /** Исполнение фоновой задачи (воркер): CSV → файл → done; ошибка уходит в
   * ретраи очереди, финальный отказ помечает воркер. */
  async run(exportId: string): Promise<void> {
    const row = await this.repo.findById(exportId);
    if (!row || row.status === 'done') return;
    await this.repo.markRunning(exportId);
    const actor: AuthUser = {
      id: row.requestedBy,
      permissions: (row.actorJson ?? []) as string[],
    } as AuthUser;
    const { csv, rowCount } = await this.build(
      actor,
      {
        entity: row.entity as CreateListExportBody['entity'],
        scope: row.scopeJson as CreateListExportBody['scope'],
        filter: row.filterJson as CreateListExportBody['filter'],
        sort: row.sortJson as CreateListExportBody['sort'],
      },
      row.columnsJson as CreateListExportBody['columns'],
    );
    const fileId = await this.saveFile(
      row.requestedBy,
      csv,
      row.entity as CreateListExportBody['entity'],
    );
    await this.repo.markDone(exportId, fileId, rowCount);
  }

  /** Финальный отказ (ретраи исчерпаны). */
  async markFailed(exportId: string, error: unknown): Promise<void> {
    await this.repo
      .markFailed(exportId, error instanceof Error ? error.message : String(error))
      .catch(() => undefined);
  }

  private sourceOf(entity: CreateListExportBody['entity']): ListExportSource {
    const source = this.sources.find((s) => s.supports(entity));
    if (!source) {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'Export of this entity is not available',
        {
          entity,
        },
      );
    }
    return source;
  }

  /** Колонки: системное поле чужой сущности — 422 (ошибка вида); удалённый
   * атрибут — колонка с пустыми значениями и пометкой в заголовке (список
   * не ломается, #435). */
  private assertColumns(body: CreateListExportBody): void {
    const system = LIST_SYSTEM_FIELDS_BY_ENTITY[body.entity] as readonly string[];
    for (const column of body.columns) {
      if (customFieldIdOfKey(column.field) === null && !system.includes(column.field)) {
        throw new DomainException(
          ErrorCode.LIST_EXPORT_COLUMN_INVALID,
          'Export column is not applicable to this entity',
          { field: column.field },
        );
      }
    }
  }

  /** CSV: заголовки — метки системных полей/имена атрибутов (удалённый —
   * пометка), строки — значения источников в порядке колонок. */
  private async build(
    actor: AuthUser,
    query: ListExportQuery,
    columns: CreateListExportBody['columns'],
  ): Promise<{ csv: string; rowCount: number }> {
    const defs = await this.customFields.definitions();
    const defNames = new Map(defs.map((d) => [d.id, d.name]));
    const header = columns.map((column) => {
      const cfId = customFieldIdOfKey(column.field);
      if (cfId === null) {
        return listSystemFieldLabel(query.entity, column.field as ListSystemField);
      }
      return defNames.get(cfId) ?? listsStrings.removedFieldLabel;
    });
    const rows: (string | number | null)[][] = [];
    for await (const row of this.sourceOf(query.entity).rows(actor, query)) {
      rows.push(columns.map((column) => row.values[column.field] ?? null));
    }
    return { csv: buildCsv(header, rows), rowCount: rows.length };
  }

  private async saveFile(ownerId: string, csv: string, entity: string): Promise<string> {
    const bytes = Buffer.from(csv, 'utf8');
    const { fileId } = await this.storage.save(
      {
        ownerId,
        name: exportFileName(entity),
        mime: 'text/csv',
        size: bytes.length,
      },
      Readable.from([bytes]),
    );
    return fileId;
  }
}
