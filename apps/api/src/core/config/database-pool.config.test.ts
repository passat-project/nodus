import { describe, expect, it } from 'vitest';

import { DATABASE_POOL_DEFAULTS, databasePoolOptions } from './database-pool.config.js';

/** AUD-022: размер пула и таймауты PG — из окружения с разумными умолчаниями. */
describe('databasePoolOptions (AUD-022)', () => {
  it('пустое окружение — умолчания кода', () => {
    expect(databasePoolOptions({})).toEqual({
      max: DATABASE_POOL_DEFAULTS.max,
      connectionTimeoutMillis: DATABASE_POOL_DEFAULTS.connectionTimeoutMillis,
      idleTimeoutMillis: DATABASE_POOL_DEFAULTS.idleTimeoutMillis,
      statement_timeout: DATABASE_POOL_DEFAULTS.statementTimeoutMs,
    });
  });

  it('значения из окружения перекрывают умолчания (мс)', () => {
    expect(
      databasePoolOptions({
        DATABASE_POOL_MAX: '2',
        DATABASE_POOL_CONNECTION_TIMEOUT_MS: '1500',
        DATABASE_POOL_IDLE_TIMEOUT_MS: '2000',
        DATABASE_STATEMENT_TIMEOUT_MS: '3000',
      }),
    ).toEqual({
      max: 2,
      connectionTimeoutMillis: 1500,
      idleTimeoutMillis: 2000,
      statement_timeout: 3000,
    });
  });

  it('кривое/пустое значение — умолчание, а не NaN', () => {
    const options = databasePoolOptions({
      DATABASE_POOL_MAX: 'abc',
      DATABASE_POOL_CONNECTION_TIMEOUT_MS: '0',
      DATABASE_POOL_IDLE_TIMEOUT_MS: '',
      DATABASE_STATEMENT_TIMEOUT_MS: '-5',
    });
    expect(options).toEqual(databasePoolOptions({}));
  });
});
