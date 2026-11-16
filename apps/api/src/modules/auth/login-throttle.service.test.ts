import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REDIS_COMMAND_TIMEOUT_MS } from '../../core/redis/redis-command.js';
import { LoginThrottleService } from './login-throttle.service.js';

describe('LoginThrottleService', () => {
  const redis = {
    status: 'ready',
    get: vi.fn(),
    eval: vi.fn(),
    del: vi.fn(),
  };
  const logger = { setContext: vi.fn(), error: vi.fn() };

  let service: LoginThrottleService;

  beforeEach(() => {
    vi.clearAllMocks();
    redis.status = 'ready';
    service = new LoginThrottleService(redis as never, logger as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('блокирует после 10 неудач за окно', async () => {
    redis.get.mockResolvedValue('9');
    expect(await service.isLocked('a@b.by')).toBe(false);
    redis.get.mockResolvedValue('10');
    expect(await service.isLocked('a@b.by')).toBe(true);
  });

  it('неудача пишет счётчик и ставит окно 10 минут одним Lua-скриптом', async () => {
    redis.eval.mockResolvedValue(1);

    await service.recordFailure('Admin@Nodus.by');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      'nodus:auth:login_fail:admin@nodus.by',
      '600',
    );
    expect(redis.eval.mock.calls[0]![0]).toContain('EXPIRE');

    await service.recordFailure('Admin@Nodus.by');
    expect(redis.eval).toHaveBeenCalledTimes(2); // окно не продлеваем: условие в скрипте
  });

  it('reset удаляет счётчик', async () => {
    await service.reset('a@b.by');
    expect(redis.del).toHaveBeenCalledWith('nodus:auth:login_fail:a@b.by');
  });

  it('Redis не готов — вход не блокируется, команда не вызывается', async () => {
    redis.status = 'reconnecting';

    expect(await service.isLocked('a@b.by')).toBe(false);
    expect(redis.get).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('Redis завис — fail-open по таймауту, error один раз', async () => {
    vi.useFakeTimers();
    redis.get.mockReturnValue(new Promise(() => undefined));

    const first = service.isLocked('a@b.by');
    const second = service.isLocked('a@b.by');
    await vi.advanceTimersByTimeAsync(REDIS_COMMAND_TIMEOUT_MS);

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('ошибка записи и сброса не мешает входу', async () => {
    redis.eval.mockRejectedValue(new Error('redis down'));
    redis.del.mockRejectedValue(new Error('redis down'));

    await expect(service.recordFailure('a@b.by')).resolves.toBeUndefined();
    await expect(service.reset('a@b.by')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('Redis недоступен: десятая неудача блокирует вход запасным счётчиком', async () => {
    redis.status = 'reconnecting';

    for (let attempt = 0; attempt < 9; attempt += 1) {
      await service.recordFailure('a@b.by');
    }
    expect(await service.isLocked('a@b.by')).toBe(false);

    await service.recordFailure('a@b.by');
    expect(await service.isLocked('a@b.by')).toBe(true);
  });

  it('успешный вход сбрасывает запасной счётчик', async () => {
    redis.status = 'reconnecting';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await service.recordFailure('A@B.by');
    }
    expect(await service.isLocked('a@b.by')).toBe(true);

    await service.reset('A@B.by');

    expect(await service.isLocked('a@b.by')).toBe(false);
  });

  it('запасной счётчик живёт окно 10 минут', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
    redis.status = 'reconnecting';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await service.recordFailure('a@b.by');
    }
    expect(await service.isLocked('a@b.by')).toBe(true);

    vi.setSystemTime(new Date('2026-11-16T10:10:01.000Z'));

    expect(await service.isLocked('a@b.by')).toBe(false);
  });

  it('лог уровня error — не чаще раза в минуту', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
    redis.status = 'reconnecting';

    await service.recordFailure('a@b.by');
    await service.recordFailure('a@b.by');
    expect(logger.error).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-11-16T10:01:01.000Z'));
    await service.recordFailure('a@b.by');
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('настоящий ioredis к закрытому порту — вход не висит', async () => {
    const realRedis = new Redis('redis://127.0.0.1:1', {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: () => 1_000,
    });
    realRedis.on('error', () => undefined);
    try {
      const realService = new LoginThrottleService(realRedis as never, logger as never);
      const started = Date.now();
      expect(await realService.isLocked('a@b.by')).toBe(false);
      await realService.recordFailure('a@b.by');
      await realService.reset('a@b.by');
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      realRedis.disconnect();
    }
  });
});
