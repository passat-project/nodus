import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { FILES_CONFIG, type FilesConfig } from '../files.config.js';
import { MinioStorageDriver, type IncompleteUploadInfo } from './minio-storage.driver.js';

/** Итог одного прохода уборки (#715) — он же метрика в логе. */
export interface StaleMultipartSweepResult {
  /** Сколько незавершённых загрузок нашлось в бакете. */
  scanned: number;
  /** Сколько отменено (брошенные, старше порога). */
  aborted: number;
  /** Байты отменённых загрузок (уже залитые части). */
  abortedBytes: number;
  /** Свежие — не тронуты (честная загрузка в процессе). */
  skippedFresh: number;
  /** Возраст неизвестен (хранилище не сообщило дату) — не тронуты. */
  skippedUnknownAge: number;
  /** Отменить не удалось (повтор — следующим проходом). */
  failed: number;
}

/**
 * Уборка брошенных multipart-загрузок бакета (#715, страховка к #713).
 * Клиент хранилища инициирует multipart-загрузку до чтения тела и при жёстком
 * падении процесса (kill/OOM/перезапуск api) не успевает её отменить: части
 * (≥64 МиБ на часть) висят в бакете бесконечно. Критерий — только возраст
 * (`STORAGE_STALE_UPLOAD_AGE_HOURS`): загрузку без даты инициации не трогаем
 * (возраст не доказан), честная загрузка на медленном канале моложе порога.
 */
@Injectable()
export class StaleMultipartSweeper {
  constructor(
    @Inject(FILES_CONFIG) private readonly config: FilesConfig,
    private readonly storage: MinioStorageDriver,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StaleMultipartSweeper.name);
  }

  /** Один проход уборки; `now` — для детерминированных тестов. */
  async sweepOnce(now: Date = new Date()): Promise<StaleMultipartSweepResult> {
    const result: StaleMultipartSweepResult = {
      scanned: 0,
      aborted: 0,
      abortedBytes: 0,
      skippedFresh: 0,
      skippedUnknownAge: 0,
      failed: 0,
    };
    const maxAgeMs = this.config.staleUploadAgeHours * 3_600_000;
    const uploads = await this.storage.listIncompleteUploads();
    result.scanned = uploads.length;

    for (const upload of uploads) {
      if (!this.isStale(upload, now, maxAgeMs)) {
        if (upload.initiatedAt === null) result.skippedUnknownAge += 1;
        else result.skippedFresh += 1;
        continue;
      }
      try {
        await this.storage.abortIncompleteUpload(upload.key, upload.uploadId);
        result.aborted += 1;
        result.abortedBytes += upload.bytes;
      } catch (error) {
        result.failed += 1;
        this.logger.warn(
          { key: upload.key, uploadId: upload.uploadId, err: error },
          'Не удалось отменить брошенную multipart-загрузку (повтор — следующим проходом)',
        );
      }
    }

    // Метрика уборки: хранилище чистится без админ-UI, наблюдение — по логу.
    this.logger.info(
      {
        scanned: result.scanned,
        aborted: result.aborted,
        abortedBytes: result.abortedBytes,
        skippedFresh: result.skippedFresh,
        skippedUnknownAge: result.skippedUnknownAge,
        failed: result.failed,
        maxAgeHours: this.config.staleUploadAgeHours,
      },
      'Уборка брошенных multipart-загрузок: проход завершён',
    );
    return result;
  }

  private isStale(upload: IncompleteUploadInfo, now: Date, maxAgeMs: number): boolean {
    if (upload.initiatedAt === null) return false;
    return now.getTime() - upload.initiatedAt.getTime() >= maxAgeMs;
  }
}
