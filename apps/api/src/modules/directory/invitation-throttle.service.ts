import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { runRedisCommand } from '../../core/redis/redis-command.js';
import { REDIS_CLIENT } from '../../core/redis/redis.module.js';

/** Окно и порог попыток по токену (#101, OWASP brute-force protection). */
const WINDOW_SECONDS = 10 * 60;
const MAX_FAILURES = 10;
const ERROR_EVERY_MS = 60_000;

interface LocalFailureState {
  count: number;
  expiresAt: number;
}

/** INCR+EXPIRE одной командой: сбой между ними оставил бы вечный счётчик. */
const RECORD_FAILURE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count`;

/** Счётчик неудач публичных страниц приглашения/сброса — по ХЕШУ токена:
 *  сырой токен не попадает ни в ключи Redis, ни в лог. Неизвестный,
 *  просроченный, израсходованный токен, чужая почта и неверный пароль —
 *  неудачи; успех сбрасывает счётчик. Redis недоступен — запасной счётчик в
 *  памяти процесса (AUD-006), fail-closed не используется. */
@Injectable()
export class InvitationThrottleService {
  private readonly localFailures = new Map<string, LocalFailureState>();
  private lastErrorAt = 0;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(InvitationThrottleService.name);
  }

  private key(tokenHash: string): string {
    return `nodus:dir:invite_fail:${tokenHash}`;
  }

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async isLocked(tokenHash: string): Promise<boolean> {
    const key = this.key(tokenHash);
    const local = this.localCount(key, Date.now());
    try {
      const count = await runRedisCommand(this.redis, () => this.redis.get(key));
      return (count !== null && Number(count) >= MAX_FAILURES) || local >= MAX_FAILURES;
    } catch (error) {
      this.errorThrottled(error);
      return local >= MAX_FAILURES;
    }
  }

  async recordFailure(tokenHash: string): Promise<void> {
    const key = this.key(tokenHash);
    try {
      await runRedisCommand(this.redis, () =>
        this.redis.eval(RECORD_FAILURE_SCRIPT, 1, key, String(WINDOW_SECONDS)),
      );
    } catch (error) {
      this.recordLocalFailure(key, Date.now());
      this.errorThrottled(error);
    }
  }

  async reset(tokenHash: string): Promise<void> {
    const key = this.key(tokenHash);
    this.localFailures.delete(key);
    try {
      await runRedisCommand(this.redis, () => this.redis.del(key));
    } catch (error) {
      this.errorThrottled(error);
    }
  }

  private localCount(key: string, now: number): number {
    const entry = this.localFailures.get(key);
    if (!entry) return 0;
    if (entry.expiresAt <= now) {
      this.localFailures.delete(key);
      return 0;
    }
    return entry.count;
  }

  private recordLocalFailure(key: string, now: number): void {
    const entry = this.localFailures.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.localFailures.set(key, { count: 1, expiresAt: now + WINDOW_SECONDS * 1_000 });
      return;
    }
    entry.count += 1;
  }

  private errorThrottled(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorAt < ERROR_EVERY_MS) return;
    this.lastErrorAt = now;
    this.logger.error(
      { err: error },
      'invitation-throttle: Redis недоступен, защита от перебора работает памятью',
    );
  }
}
