import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';
import { databasePoolOptions, type DatabasePoolOptions } from '../config/database-pool.config.js';

/**
 * Единственная точка создания PrismaClient (Prisma 7 + driver adapter pg).
 * Канон: используется только в `*.repository.ts` модулей, `infra/` и
 * `TransactionRunner` — нигде больше (patterns.md).
 *
 * AUD-022: пул и таймауты задаются через окружение (`DATABASE_POOL_*`,
 * `DATABASE_STATEMENT_TIMEOUT_MS`) — PrismaPg принимает их как pg.PoolConfig.
 * Значения видны в логе старта.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Prisma');
  private readonly poolOptions: DatabasePoolOptions;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      // Дублирует validateEnv для тестов, где сервис создаётся напрямую.
      throw new Error('DATABASE_URL не задан');
    }
    const poolOptions = databasePoolOptions();
    super({ adapter: new PrismaPg({ connectionString, ...poolOptions }) });
    this.poolOptions = poolOptions;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(
      `Пул PG: max=${this.poolOptions.max}, ` +
        `connectionTimeoutMillis=${this.poolOptions.connectionTimeoutMillis}, ` +
        `idleTimeoutMillis=${this.poolOptions.idleTimeoutMillis}, ` +
        `statement_timeout=${this.poolOptions.statement_timeout}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
