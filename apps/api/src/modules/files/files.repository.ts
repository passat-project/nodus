import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';

export interface FileObjectRow {
  id: string;
  ownerId: string;
  bucket: string;
  key: string;
  version: number;
  name: string;
  mime: string;
  size: number;
  scanStatus: string;
  /** Дериват (превью #150): id файла-оригинала; null — пользовательский файл. */
  derivedFrom: string | null;
  createdAt: Date;
}

export interface FileVersionRow {
  id: string;
  fileObjectId: string;
  version: number;
  key: string;
  size: number;
  mime: string;
  sourceKey: string | null;
  sourceLastsave: bigint | null;
  createdAt: Date;
}

/**
 * Репозиторий модуля files: единственный, кто трогает таблицы file_objects/
 * file_versions (I3/I6). Чужие модули ссылаются на файлы plain UUID (правило
 * data-model: между таблицами модулей — без FK).
 */
@Injectable()
export class FilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** FileObject + FileVersion v1 одной транзакции (после успешного put). */
  async createWithVersion(row: {
    id: string;
    ownerId: string;
    bucket: string;
    key: string;
    name: string;
    mime: string;
    size: number;
    derivedFrom?: string | null;
  }): Promise<FileObjectRow> {
    const created = await this.prisma.fileObject.create({
      data: {
        id: row.id,
        ownerId: row.ownerId,
        bucket: row.bucket,
        key: row.key,
        version: 1,
        name: row.name,
        mime: row.mime,
        size: row.size,
        scanStatus: 'pending',
        derivedFrom: row.derivedFrom ?? null,
        versions: {
          create: {
            version: 1,
            key: row.key,
            size: row.size,
            mime: row.mime,
          },
        },
      },
    });
    return created;
  }

  async findById(id: string): Promise<FileObjectRow | null> {
    return this.prisma.fileObject.findFirst({ where: { id, deletedAt: null } });
  }

  /** Живые файлы по id пачкой (#55): метаданные для вложений писем. */
  findByIds(ids: readonly string[]): Promise<FileObjectRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.fileObject.findMany({
      where: { id: { in: [...ids] }, deletedAt: null },
    });
  }

  /** Все версии файла (новые сверху) — история просмотрщика (#138). */
  async findVersions(fileObjectId: string): Promise<FileVersionRow[]> {
    return this.prisma.fileVersion.findMany({
      where: { fileObjectId },
      orderBy: { version: 'desc' },
    });
  }

  async findVersion(fileObjectId: string, version: number): Promise<FileVersionRow | null> {
    return this.prisma.fileVersion.findUnique({
      where: { fileObjectId_version: { fileObjectId, version } },
    });
  }

  /**
   * Замок строки файла + свежее состояние для сохранения версии (AUD-015,
   * #866): `FOR UPDATE` сериализует параллельные колбэки ONLYOFFICE —
   * номер версии и дедуп считаются по заблокированной строке, а не по
   * чтению вне транзакции. Все, кто создаёт версии, обязаны брать этот замок
   * первым шагом транзакции. null — файл удалён/не найден.
   */
  async lockForSave(
    tx: TransactionClient,
    fileObjectId: string,
  ): Promise<{ file: FileObjectRow; latest: FileVersionRow | null } | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM file_objects
      WHERE id = ${fileObjectId}::uuid AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (rows.length === 0) return null;
    const file = await tx.fileObject.findUnique({ where: { id: fileObjectId } });
    if (!file) return null;
    const latest = await tx.fileVersion.findFirst({
      where: { fileObjectId },
      orderBy: { version: 'desc' },
    });
    return { file, latest };
  }

  /**
   * Сохранение новой версии из колбэка ONLYOFFICE (#138): строка версии +
   * перевод указателя file_objects (key/size/version) одной транзакцией —
   * вызывающий сервис добавляет в неё событие outbox (I9).
   */
  async saveVersion(
    tx: TransactionClient,
    input: {
      fileObjectId: string;
      version: number;
      key: string;
      size: number;
      mime: string;
      sourceKey: string;
      sourceLastsave: bigint | null;
    },
  ): Promise<FileVersionRow> {
    const row = await tx.fileVersion.create({
      data: {
        fileObjectId: input.fileObjectId,
        version: input.version,
        key: input.key,
        size: input.size,
        mime: input.mime,
        sourceKey: input.sourceKey,
        sourceLastsave: input.sourceLastsave,
      },
    });
    await tx.fileObject.update({
      where: { id: input.fileObjectId },
      data: { key: input.key, size: input.size, version: input.version },
    });
    return row;
  }

  /** Строки (с ключами всех версий) для удаления объектов из хранилища.
   * #156: вместе с оригиналом сносятся его дериваты (derivedFrom — превью
   * #150) и объекты производных конвейера #139 — сирот в SILO не остаётся. */
  async findForRemoval(fileIds: string[]): Promise<{ keys: string[]; ids: string[] }> {
    if (fileIds.length === 0) return { keys: [], ids: [] };
    const objects = await this.prisma.fileObject.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, key: true, versions: { select: { key: true } } },
    });
    const ids = objects.map((object) => object.id);
    const [derivatives, derived] = await Promise.all([
      this.prisma.fileDerivative.findMany({
        where: { fileObjectId: { in: ids }, key: { not: null } },
        select: { key: true },
      }),
      this.prisma.fileObject.findMany({
        where: { derivedFrom: { in: ids } },
        select: { id: true, key: true },
      }),
    ]);
    const keys = new Set<string>();
    for (const object of objects) {
      keys.add(object.key);
      for (const version of object.versions) keys.add(version.key);
    }
    for (const row of derivatives) if (row.key) keys.add(row.key);
    // Дериваты-FileObject (#150) сносятся вместе со СВОИМИ версиями.
    for (const object of derived) {
      keys.add(object.key);
    }
    const derivedVersions = derived.length
      ? await this.prisma.fileVersion.findMany({
          where: { fileObjectId: { in: derived.map((object) => object.id) } },
          select: { key: true },
        })
      : [];
    for (const version of derivedVersions) keys.add(version.key);
    return { keys: [...keys], ids: [...ids, ...derived.map((object) => object.id)] };
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.fileObject.deleteMany({ where: { id: { in: ids } } });
  }
}
