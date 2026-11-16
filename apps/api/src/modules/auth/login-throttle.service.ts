import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { runRedisCommand } from '../../core/redis/redis-command.js';
import { REDIS_CLIENT } from '../../core/redis/redis.module.js';

/** Окно и порог пер-аккаунтного ограничения входа (OWASP throttling). */
const WINDOW_SECONDS = 10 * 60;
const MAX_FAILURES = 10;
const ERROR_EVERY_MS = 60_000;

/** Запасной счётчик на время недоступности Redis (AUD-006). */
interface LocalFailureState {
  count: number;
  expiresAt: number;
}

/** INCR+EXPIRE одной командой: сбой между ними оставил бы счётчик без TTL —
 *  вечная блокировка учётки после десяти неудач. */
const RECORD_FAILURE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count`;

const keyFor = (email: string): string => `nodus:auth:login_fail:${email.toLowerCase()}`;

/**
 * Счётчик неудачных входов по учётке (Redis, cache-aside конвенция ключей
 * `nodus:<module>:`). Защита от брутфорса, устойчивая к NAT: ограничиваем
 * аккаунт, а не IP офиса. Сброс — при успешном входе.
 *
 * Недоступный Redis: защита не выключается — неудачи считает запасной счётчик
 * в памяти процесса с тем же окном и порогом (AUD-006), сброс — при успешном
 * входе. Счётчик не делится между экземплярами — приемлемо для одного
 * процесса api. Лог — `error` не чаще раза в минуту (признак для алерта);
 * fail-closed не используется: отказ Redis не должен ронять вход в портал.
 */
@Injectable()
export class LoginThrottleService {
  private readonly localFailures = new Map<string, LocalFailureState>();
  private lastErrorAt = 0;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LoginThrottleService.name);
  }

  /** true — вход временно заблокирован (≥ MAX_FAILURES за окно). */
  async isLocked(email: string): Promise<boolean> {
    const key = keyFor(email);
    const local = this.localCount(key, Date.now());
    try {
      const count = await runRedisCommand(this.redis, () => this.redis.get(key));
      return (count !== null && Number(count) >= MAX_FAILURES) || local >= MAX_FAILURES;
    } catch (error) {
      this.errorThrottled(error);
      return local >= MAX_FAILURES;
    }
  }

  /** Фиксирует неудачу; INCR+EXPIRE выполняются одним Lua-скриптом. */
  async recordFailure(email: string): Promise<void> {
    const key = keyFor(email);
    try {
      await runRedisCommand(this.redis, () =>
        this.redis.eval(RECORD_FAILURE_SCRIPT, 1, key, String(WINDOW_SECONDS)),
      );
    } catch (error) {
      this.recordLocalFailure(key, Date.now());
      this.errorThrottled(error);
    }
  }

  async reset(email: string): Promise<void> {
    const key = keyFor(email);
    this.localFailures.delete(key);
    try {
      await runRedisCommand(this.redis, () => this.redis.del(key));
    } catch (error) {
      this.errorThrottled(error);
    }
  }

  /** Счётчик неудач в памяти на время недоступности Redis; окно — как у Redis. */
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
      'login-throttle: Redis недоступен, защита от перебора работает запасным счётчиком в памяти',
    );
  }
}
