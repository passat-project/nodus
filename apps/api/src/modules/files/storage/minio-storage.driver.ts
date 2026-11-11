import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import * as Minio from 'minio';
import { Transform, type Readable } from 'node:stream';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { FILES_CONFIG, type FilesConfig } from '../files.config.js';

export interface PutResult {
  etag: string | null;
  /** Фактически прожитые байты (сверка с заявленным size — провайдером). */
  bytes: number;
}

/** Незавершённая multipart-загрузка бакета (#715). */
export interface IncompleteUploadInfo {
  key: string;
  uploadId: string;
  /** Момент инициации (S3 `Initiated`); null — хранилище дату не сообщило:
   *  возраст неизвестен, такую загрузку уборка не трогает (fail-safe). */
  initiatedAt: Date | null;
  /** Уже залитые части — для метрики уборки (байт). */
  bytes: number;
}

/**
 * Драйвер MinIO (S3 API) — реализация транспортной части хранилища ADR-0013.
 * Живёт внутри модуля files: бакеты/ключи наружу не выходят (наружу — порт
 * FILE_STORAGE). Стрим без буферизации: putObject требует заявленный size,
 * фактический подсчёт — обёрткой-счётчиком (обрыв/подмена = мусор не храним).
 */
@Injectable()
export class MinioStorageDriver implements OnModuleInit {
  private readonly client: Minio.Client;

  constructor(@Inject(FILES_CONFIG) private readonly config: FilesConfig) {
    this.client = new Minio.Client({
      endPoint: config.endpoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  /** Бакет создаётся лениво на старте (compose-контур делает это minio-init,
   *  host-dev/CI — здесь; идемпотентно). Fail-fast: недоступный MinIO —
   *  понятная ошибка старта, а не 500-е на каждом вложении. */
  async onModuleInit(): Promise<void> {
    const { bucket } = this.config;
    if (!(await this.client.bucketExists(bucket))) {
      await this.client.makeBucket(bucket);
    }
  }

  async put(key: string, size: number, mime: string, content: Readable): Promise<PutResult> {
    let bytes = 0;
    const counted = content.pipe(
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          callback(null, chunk);
        },
      }),
    );
    try {
      const info = await this.client.putObject(this.config.bucket, key, counted, size, {
        'Content-Type': mime,
      });
      return { etag: info.etag ?? null, bytes };
    } catch (error) {
      // Файлы > 64 МиБ идут multipart-путём, а SDK инициирует такую загрузку
      // ДО чтения тела и НЕ отменяет её при обрыве: без явного abort в
      // хранилище навсегда остаются залитые части (ключ — UUID, «продолжение»
      // по нему невозможно, DeleteObject их не видит; #713, security-ревью).
      await this.abortIncomplete(key);
      // Обрыв/подмена размера часто валит сам SDK (Content-Length не сойдётся)
      // — переводим в доменную ошибку по счётчику, объект подчищаем.
      if (bytes !== size) {
        await this.remove([key]).catch(() => undefined);
        throw new DomainException(
          ErrorCode.FILE_SIZE_MISMATCH,
          'Streamed bytes do not match declared size',
          { declared: size, streamed: bytes },
        );
      }
      throw error;
    }
  }

  /**
   * Отменить незавершённую multipart-загрузку ключа (best effort). Части,
   * брошенные при обрыве соединения/сбое, иначе не убирает никто: ключ —
   * свежий UUID, объект ещё не создан, а DeleteObject загрузку не отменяет.
   * Требует ListBucketMultipartUploads (искать) + AbortMultipartUpload.
   */
  private async abortIncomplete(key: string): Promise<void> {
    try {
      await this.client.removeIncompleteUpload(this.config.bucket, key);
    } catch {
      // Сбой уборки не должен подменять исходную ошибку загрузки.
    }
  }

  /**
   * Перечислить незавершённые multipart-загрузки бакета (#715): брошенные
   * жёстким падением процесса (kill/OOM/перезапуск api) не убирает никто —
   * ключ свежий UUID, «продолжение» по нему невозможно, DeleteObject загрузку
   * не отменяет, ILM-правила на незавершённые загрузки в SILO нет.
   * SDK отдаёт байты частей (listParts на каждую загрузку), дату инициации —
   * в поле `initiated` ответа ListMultipartUploads (в типе пакета не объявлена).
   */
  async listIncompleteUploads(): Promise<IncompleteUploadInfo[]> {
    const uploads: IncompleteUploadInfo[] = [];
    const stream = this.client.listIncompleteUploads(this.config.bucket, '', true);
    for await (const item of stream) {
      const raw = item as { key?: string; uploadId?: string; size?: number; initiated?: Date };
      // Нерекурсивный листинг отдаёт ещё и префиксы — нам нужны только загрузки.
      if (!raw.key || !raw.uploadId) continue;
      const initiated = raw.initiated instanceof Date ? raw.initiated : null;
      uploads.push({
        key: raw.key,
        uploadId: raw.uploadId,
        initiatedAt: initiated && !Number.isNaN(initiated.getTime()) ? initiated : null,
        bytes: raw.size ?? 0,
      });
    }
    return uploads;
  }

  /** Отменить конкретную незавершённую загрузку по uploadId (#715): точнее
   *  поиска по ключу (не задевает новую загрузку того же ключа). */
  async abortIncompleteUpload(key: string, uploadId: string): Promise<void> {
    await this.client.abortMultipartUpload(this.config.bucket, key, uploadId);
  }

  async get(key: string): Promise<Readable> {
    return this.client.getObject(this.config.bucket, key);
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.removeObjects(this.config.bucket, keys);
  }
}
