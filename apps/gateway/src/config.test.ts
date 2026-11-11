import { describe, expect, it } from 'vitest';

import { loadGatewayConfig } from './config.ts';

const VALID = {
  JWT_SECRET: 'env-test-secret-key-min-32-chars-long',
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/nodus',
};

describe('loadGatewayConfig (#675)', () => {
  it('дефолты прод/Docker: порт 3002 и все интерфейсы', () => {
    const config = loadGatewayConfig({ ...VALID });
    expect(config.GATEWAY_PORT).toBe(3002);
    expect(config.GATEWAY_HOST).toBe('0.0.0.0');
  });

  it('GATEWAY_HOST сужает интерфейс (песочница live-stack)', () => {
    const config = loadGatewayConfig({
      ...VALID,
      GATEWAY_PORT: '3012',
      GATEWAY_HOST: '127.0.0.1',
    });
    expect(config.GATEWAY_PORT).toBe(3012);
    expect(config.GATEWAY_HOST).toBe('127.0.0.1');
  });

  it('пустой GATEWAY_HOST — понятная ошибка старта', () => {
    expect(() => loadGatewayConfig({ ...VALID, GATEWAY_HOST: '' })).toThrow(/GATEWAY_HOST/);
  });
});
