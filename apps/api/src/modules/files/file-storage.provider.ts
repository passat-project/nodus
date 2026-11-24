import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import type {
  FileStorage,
  FileStorageContent,
  FileStorageSaveInput,
} from '../../core/ports/file-storage.port.js';
import { FILES_CONFIG, STORAGE_MAX_FILE_BYTES, type FilesConfig } from './files.config.js';
import { FilesRepository } from './files.repository.js';
import { safeContentType } from './safe-content-type.js';
import { safeFileName } from './safe-file-name.js';
import { MinioStorageDriver } from './storage/minio-storage.driver.js';

/**
 * Реализация порта FILE_STORAGE (ADR-0013): сохранение — стрим в MinIO, затем
 * file_objects + file_versions (v1) в БД. Порядок «объект раньше строки»:
 * незаписанная строка после сбоя БД оставляет объект-сироту (уборка — фаза 2),
 * зато строка никогда не ссылается на несуществующий объект.
 */
@Injectable()
export class FileStorageProvider implements FileStorage {
  constructor(
    private readonly driver: MinioStorageDriver,
    private readonly repository: FilesRepository,
    @Inject(FILES_CONFIG) private readonly config: FilesConfig,
  ) {}

  async save(input: FileStorageSaveInput, content: Readable): Promise<{ fileId: string }> {
    if (!Number.isSafeInteger(input.size) || input.size < 0) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Invalid file size declared');
    }
    if (input.size > STORAGE_MAX_FILE_BYTES) {
      throw new DomainException(
        ErrorCode.FILE_SIZE_MISMATCH,
        'File exceeds storage limit',
        { maxBytes: STORAGE_MAX_FILE_BYTES },
        413,
      );
    }

    const fileId = randomUUID();
    // Имя и mime — клиентские (multipart): санитизируем при сохранении, чтобы
    // заголовки отдачи/вложения и метаданные хранилища не ломались длиной,
    // управляющими символами или не-форматом (security-ревью #1005).
    const name = safeFileName(input.name);
    const mime = safeContentType(input.mime);
    // Ключ = детерминированная функция id: без санитизации имён (исходное имя
    // живёт в БД), карантинный префикс quarantine/ — фаза 2 (сканер).
    const key = `files/${fileId}`;
    const { bytes } = await this.driver.put(key, input.size, mime, content);
    if (bytes !== input.size) {
      // Обрыв/подмена размера: объект не храним, ссылку не выдаём.
      await this.driver.remove([key]);
      throw new DomainException(
        ErrorCode.FILE_SIZE_MISMATCH,
        'Streamed bytes do not match declared size',
        { declared: input.size, streamed: bytes },
      );
    }

    await this.repository.createWithVersion({
      id: fileId,
      ownerId: input.ownerId,
      bucket: this.config.bucket,
      key,
      name,
      mime,
      size: input.size,
      derivedFrom: input.derivedFrom ?? null,
    });
    return { fileId };
  }

  async get(fileId: string): Promise<FileStorageContent | null> {
    const row = await this.repository.findById(fileId);
    if (!row) return null;
    try {
      const stream = await this.driver.get(row.key);
      // Legacy-строки (до санитизации на входе, #1005) отдаём потребителям
      // чистыми: имя/mime — единая точка, а не каждый потребитель.
      return {
        stream,
        mime: safeContentType(row.mime),
        name: safeFileName(row.name),
        size: row.size,
      };
    } catch {
      // объект исчез (уборка/сбой) — для потребителя это «файла нет»
      return null;
    }
  }

  async remove(fileIds: string[]): Promise<void> {
    const { keys, ids } = await this.repository.findForRemoval(fileIds);
    await this.driver.remove(keys);
    await this.repository.deleteMany(ids);
  }
}
