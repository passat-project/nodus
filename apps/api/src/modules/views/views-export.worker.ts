import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { ListExportService } from './list-export.service.js';
import { VIEWS_EXPORT_QUEUE, VIEWS_EXPORT_QUEUE_PREFIX } from './views-export.queue.js';

/**
 * In-process BullMQ-воркер выгрузки списков (#435, паттерн letter-body-pdf):
 * конвейер лёгкий (SQL + сборка строки) — concurrency 4. Отказ — ретраи
 * очереди; исчерпаны — статус failed с текстом ошибки (автор видит в UI).
 */
@Injectable()
export class ViewsExportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly connection: Redis;
  private worker?: Worker<{ exportId: string }>;

  constructor(
    private readonly service: ListExportService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ViewsExportWorker.name);
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL не задан');
    this.connection = new Redis(url, { maxRetriesPerRequest: null });
  }

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<{ exportId: string }>(
      VIEWS_EXPORT_QUEUE,
      async (job) => {
        await this.service.run(job.data.exportId);
      },
      { connection: this.connection, concurrency: 4, prefix: VIEWS_EXPORT_QUEUE_PREFIX },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.warn(
        { exportId: job?.data.exportId, attempts: job?.attemptsMade, err: error },
        'Выгрузка списка не собрана (ретраи очереди)',
      );
      if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
        void this.service.markFailed(job.data.exportId, error);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.connection.disconnect();
  }
}
