import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { createRedisClient, duplicateRedisClient } from '../../../core/redis/redis-connection.js';
import { FILES_CONFIG, type FilesConfig } from '../files.config.js';
import { StaleMultipartSweeper } from './stale-multipart.sweeper.js';

/** Имя без двоеточий (BullMQ, урок #157); префикс nodus (конвенция). */
export const STALE_UPLOADS_QUEUE = 'files-stale-uploads';
export const STALE_UPLOADS_PREFIX = 'nodus';
/** Стабильный id расписания: upsert идемпотентен на каждом старте api. */
export const STALE_UPLOADS_SCHEDULER_ID = 'stale-multipart-daily';

/** Дескриптор расписания уборки (#715): интервал — из конфига, чистая функция
 *  (unit-тест планировщика без BullMQ/Redis). */
export function staleUploadsSchedule(config: FilesConfig): {
  schedulerId: string;
  jobName: string;
  everyMs: number;
} {
  return {
    schedulerId: STALE_UPLOADS_SCHEDULER_ID,
    jobName: 'sweep',
    everyMs: config.staleUploadIntervalHours * 3_600_000,
  };
}

/**
 * Периодическая уборка брошенных multipart-загрузок (#715): repeatable-джоб
 * BullMQ (Job Scheduler API — расписание upsert'ом по стабильному id, как
 * retention/mail-poll; `@nestjs/schedule` в проекте нет). Раз в сутки
 * (`STORAGE_STALE_UPLOAD_INTERVAL_HOURS`) перечисляет незавершённые загрузки
 * бакета и отменяет те, что старше `STORAGE_STALE_UPLOAD_AGE_HOURS`, с логом
 * количества и байт. Права `s3:ListBucketMultipartUploads` (выдано #713) и
 * `s3:AbortMultipartUpload` (было) — у сервисной учётки уже есть.
 */
@Injectable()
export class StaleMultipartUploadsJob implements OnModuleInit, OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<Record<string, never>>;
  private worker?: Worker<Record<string, never>>;

  constructor(
    @Inject(FILES_CONFIG) private readonly config: FilesConfig,
    private readonly sweeper: StaleMultipartSweeper,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StaleMultipartUploadsJob.name);
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL не задан');
    this.connection = createRedisClient(url, 'api:bull:stale-uploads', {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue(STALE_UPLOADS_QUEUE, {
      connection: this.connection,
      prefix: STALE_UPLOADS_PREFIX,
    });
  }

  async onModuleInit(): Promise<void> {
    const { schedulerId, jobName, everyMs } = staleUploadsSchedule(this.config);
    await this.queue.upsertJobScheduler(
      schedulerId,
      { every: everyMs },
      { name: jobName, data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    );
    this.worker = new Worker<Record<string, never>>(
      STALE_UPLOADS_QUEUE,
      async () => {
        await this.sweeper.sweepOnce();
      },
      {
        connection: duplicateRedisClient(this.connection, 'api:bull:stale-uploads:worker'),
        prefix: STALE_UPLOADS_PREFIX,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (_job, error) => {
      this.logger.warn(
        { err: error },
        'Уборка брошенных загрузок не удалась (повтор по расписанию)',
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
