import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

/** Имя без двоеточий (BullMQ, урок #157); префикс nodus (конвенция). */
export const VIEWS_EXPORT_QUEUE = 'views-export';
export const VIEWS_EXPORT_QUEUE_PREFIX = 'nodus';

/**
 * Продюсер очереди выгрузки списков (#435): CSV больше csvSyncRows строк —
 * тяжёлая работа, только очередь (I7). Постановка best-effort с warn-логом:
 * недоступный Redis не валит заказ (статус остаётся queued, воркер дорабо-
 * тает после починки; повторный POST с тем же Idempotency-Key не дублирует).
 */
@Injectable()
export class ViewsExportQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<{ exportId: string }>;

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ViewsExportQueue.name);
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL не задан');
    this.connection = new Redis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue(VIEWS_EXPORT_QUEUE, {
      connection: this.connection,
      prefix: VIEWS_EXPORT_QUEUE_PREFIX,
    });
  }

  /** jobId = views-export-<id> — идемпотентность: повторная постановка не
   * плодит дубли (идемпотентность HTTP — Idempotency-Key выше по стеку). */
  async enqueue(exportId: string): Promise<void> {
    try {
      await this.queue.add(
        'build',
        { exportId },
        {
          jobId: `views-export-${exportId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    } catch (error) {
      this.logger.warn({ exportId, err: error }, 'Постановка выгрузки не удалась (не критично)');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
