import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { runRedisCommand } from '../../core/redis/redis-command.js';
import { REDIS_CLIENT } from '../../core/redis/redis.module.js';
import { AuthRepository } from './auth.repository.js';
import { getAuthConfig } from './auth.config.js';

/** Запас к моменту деактивации: `createdAt` события — начало транзакции в
 *  часах PG, а refresh/login, прочитавший статус до её коммита, подпишет
 *  токен на миллисекунды позже (`iat` — часы Node, точность — секунда). */
const REVOKE_MARGIN_SECONDS = 5;
const ERROR_EVERY_MS = 60_000;

/** SET только вперёд: повтор старого события (бэкофф диспетчера) не
 *  откатывает момент более позднего увольнения. */
const SET_MAX_SCRIPT = `
local cur = tonumber(redis.call('GET', KEYS[1]))
if (not cur) or tonumber(ARGV[1]) > cur then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
end
return 1`;

/**
 * Отзыв действующих access-токенов уволенного сотрудника (#333). Access-JWT
 * stateless (15 мин), поэтому после деактивации нужен стоп-лист:
 * `nodus:auth:revoked-before:<userId>` = момент деактивации + запас (секунды
 * epoch). Токен с `iat` не позже этого момента отвергается. TTL записи = TTL
 * access-токена + запас: к её истечению все токены, выданные до
 * деактивации, умерли сами, а новые не выдаются (вход и refresh проверяют
 * статус, сессии отозваны). Повторная активация не требует снятия записи:
 * новые токены выпущены позже (кроме первых секунд запаса — один 401 и
 * refresh).
 *
 * Недоступный Redis: проверка — запасная по статусу пользователя в БД
 * (деактивирован → токен отозван), лог `error` не чаще раза в минуту
 * (AUD-006). БД тоже недоступна — пропуск (fail-open): отказ Redis не должен
 * превращаться в отказ портала. Запись — ошибка: диспетчер повторит событие
 * с бэкоффом, а не повиснет.
 */
@Injectable()
export class RevokedUsersStore {
  private readonly ttlSeconds = getAuthConfig().accessTtlSeconds + 60;
  private lastErrorAt = 0;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
    private readonly authRepository: AuthRepository,
  ) {
    this.logger.setContext(RevokedUsersStore.name);
  }

  private key(userId: string): string {
    // Канонический UUID в нижнем регистре: ParseUUIDPipe пропускает верхний,
    // иначе маркер роли/подразделения не совпал бы с `sub` токена (#101).
    return `nodus:auth:revoked-before:${userId.toLowerCase()}`;
  }

  /** Отзыв всех токенов, выданных не позже `at` (+ запас). */
  async revoke(userId: string, at: Date = new Date()): Promise<void> {
    const seconds = Math.floor(at.getTime() / 1000) + REVOKE_MARGIN_SECONDS;
    await runRedisCommand(this.redis, () =>
      this.redis.eval(
        SET_MAX_SCRIPT,
        1,
        this.key(userId),
        String(seconds),
        String(this.ttlSeconds),
      ),
    );
  }

  /** Токен выдан до деактивации владельца → отозван. */
  async isRevoked(userId: string, issuedAtSeconds: number | undefined): Promise<boolean> {
    let raw: string | null;
    try {
      raw = await runRedisCommand(this.redis, () => this.redis.get(this.key(userId)));
    } catch (error) {
      this.errorThrottled(error);
      return this.isDeactivatedInDb(userId);
    }
    if (raw === null) return false;
    return issuedAtSeconds === undefined || issuedAtSeconds <= Number(raw);
  }

  /** Запасной источник при недоступном Redis (AUD-006): статус в БД —
   *  источник истины о деактивации. Нет строки — пользователя больше нет,
   *  токен тоже недействителен. Ошибка БД — fail-open (портал не встаёт). */
  private async isDeactivatedInDb(userId: string): Promise<boolean> {
    try {
      const profile = await this.authRepository.findProfileById(userId);
      return !profile || profile.status !== 'active';
    } catch {
      return false;
    }
  }

  private errorThrottled(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorAt < ERROR_EVERY_MS) return;
    this.lastErrorAt = now;
    this.logger.error(
      { err: error },
      'revoked-users: Redis недоступен, проверка стоп-листа по статусу в БД',
    );
  }
}
