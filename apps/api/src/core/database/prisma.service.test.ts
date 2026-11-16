import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adapter = vi.hoisted(() =>
  vi.fn(function (this: { provider: string; adapterName: string }) {
    this.provider = 'postgres';
    this.adapterName = '@prisma/adapter-pg';
  }),
);
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: adapter }));

import { PrismaService } from './prisma.service.js';

const CONNECTION = 'postgresql://nodus:secret@localhost:5432/nodus';
const POOL_ENV = [
  'DATABASE_POOL_MAX',
  'DATABASE_POOL_CONNECTION_TIMEOUT_MS',
  'DATABASE_POOL_IDLE_TIMEOUT_MS',
  'DATABASE_STATEMENT_TIMEOUT_MS',
];

/** AUD-022: PrismaPg получает пул и таймауты из окружения (pg.PoolConfig). */
describe('PrismaService — параметры пула (AUD-022)', () => {
  beforeEach(() => {
    adapter.mockClear();
    process.env.DATABASE_URL = CONNECTION;
    for (const key of POOL_ENV) delete process.env[key];
  });

  afterEach(() => {
    for (const key of POOL_ENV) delete process.env[key];
  });

  it('передаёт в PrismaPg значения окружения', () => {
    process.env.DATABASE_POOL_MAX = '2';
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = '1500';
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = '2000';
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = '3000';
    new PrismaService();
    expect(adapter).toHaveBeenCalledWith({
      connectionString: CONNECTION,
      max: 2,
      connectionTimeoutMillis: 1500,
      idleTimeoutMillis: 2000,
      statement_timeout: 3000,
    });
  });

  it('без переменных — умолчания пула', () => {
    new PrismaService();
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: CONNECTION,
        max: 20,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
        statement_timeout: 30_000,
      }),
    );
  });
});
