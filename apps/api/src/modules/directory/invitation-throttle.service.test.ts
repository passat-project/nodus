import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvitationThrottleService } from './invitation-throttle.service.js';

/** Троттлинг публичных ссылок (#101): по хешу токена, с запасным счётчиком. */

function redis(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ready',
    get: vi.fn(async () => null),
    eval: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    ...overrides,
  };
}

const logger = { setContext: vi.fn(), error: vi.fn() };

function service(client: ReturnType<typeof redis>) {
  return new InvitationThrottleService(client as never, logger as never);
}

describe('InvitationThrottleService (#101)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('хеш токена — SHA-256, сырой токен не используется как ключ', () => {
    const hash = InvitationThrottleService.hashToken('raw-token');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('raw-token');
  });

  it('блокировка по счётчику Redis и сброс при успехе', async () => {
    const client = redis({ get: vi.fn(async () => '10') });
    const throttle = service(client);
    await expect(throttle.isLocked('h')).resolves.toBe(true);
    await throttle.recordFailure('h');
    expect(client.eval).toHaveBeenCalled();
    await throttle.reset('h');
    expect(client.del).toHaveBeenCalledWith('nodus:dir:invite_fail:h');
  });

  it('Redis недоступен — запасной счётчик в памяти держит порог', async () => {
    const client = redis({ status: 'end' });
    const throttle = service(client);
    for (let i = 0; i < 10; i += 1) await throttle.recordFailure('h');
    await expect(throttle.isLocked('h')).resolves.toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });
});
