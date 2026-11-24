import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AuditRepository } from '../../core/audit/audit.repository.js';
import { createRedisClient, duplicateRedisClient } from '../../core/redis/redis-connection.js';
import { InvitationsService } from './invitations.service.js';

export const INVITATION_EXPIRY_QUEUE = 'directory-invitation-expiry';
export const INVITATION_EXPIRY_PREFIX = 'nodus';
/** Сколько строк-приглашений разбираем за один проход. */
const EXPIRY_BATCH = 50;

/**
 * Автоистечение приглашений (#101): раз в час BullMQ Job Scheduler ищет
 * приглашённых без действующей ссылки. Строку, которую НИКОГДА не
 * активировали, удаляет; бывшего сотрудника возвращает в «Уволен» (история
 * цела). Аудит — напрямую `AuditRepository` (HTTP-интерцептор здесь не живёт),
 * действие `directory.invitation.expire` с `actorId = null` и исходом.
 */
@Injectable()
export class InvitationExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<Record<string, never>>;
  private worker?: Worker<Record<string, never>>;

  constructor(
    private readonly invitations: InvitationsService,
    private readonly audit: AuditRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InvitationExpiryJob.name);
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL не задан');
    this.connection = createRedisClient(url, 'api:bull:invitation-expiry', {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue(INVITATION_EXPIRY_QUEUE, {
      connection: this.connection,
      prefix: INVITATION_EXPIRY_PREFIX,
    });
  }

  async onModuleInit(): Promise<void> {
    // Идемпотентная регистрация расписания (Job Scheduler API BullMQ 6).
    await this.queue.upsertJobScheduler(
      'invitation-expiry-hourly',
      { pattern: '0 * * * *' },
      {
        name: 'expire',
        data: {},
        opts: { removeOnComplete: 10, removeOnFail: 50 },
      },
    );
    this.worker = new Worker<Record<string, never>>(
      INVITATION_EXPIRY_QUEUE,
      async () => {
        await this.runOnce();
      },
      { connection: this.duplicateConnection(), prefix: INVITATION_EXPIRY_PREFIX, concurrency: 1 },
    );
    this.worker.on('failed', (_job, error) => {
      this.logger.warn({ err: error }, 'Истечение приглашений не удалось (повтор по расписанию)');
    });
  }

  /** Один проход — public для тестов и интеграционных прогонов. */
  async runOnce(): Promise<number> {
    const expired = await this.invitations.expireInvitations(EXPIRY_BATCH);
    for (const entry of expired) {
      await this.audit
        .append({
          actorId: null,
          action: 'directory.invitation.expire',
          entityType: 'user',
          entityId: entry.userId,
          details: { removed: entry.removed },
        })
        .catch((error: unknown) =>
          this.logger.error(
            { err: error, userId: entry.userId },
            'Аудит истечения приглашения не записан',
          ),
        );
    }
    if (expired.length > 0) {
      this.logger.info({ count: expired.length }, 'Приглашения истекли');
    }
    return expired.length;
  }

  private duplicateConnection(): Redis {
    return duplicateRedisClient(this.connection, 'api:bull:invitation-expiry:worker');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
