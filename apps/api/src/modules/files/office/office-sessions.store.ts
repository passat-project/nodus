import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { runRedisCommand } from '../../../core/redis/redis-command.js';
import { REDIS_CLIENT } from '../../../core/redis/redis.module.js';

/**
 * Реестр открытых офисных сессий правки (#356): document key ↔ пользователь.
 * Нужен, чтобы при деактивации сотрудника разорвать ЕГО сессии в Document
 * Server командой `drop` (DS не спрашивает статус при сохранении).
 *
 * В памяти api реестр не годится: сессия DS живёт до 24 ч и переживает
 * рестарт api; Redis — общий с песочницей и переживает рестарт. TTL с запасом
 * на долгоживущие редакторы: команда `drop` должна найти ключ и позже суток.
 * Сбой Redis не валит открытие редактора — реестр best-effort; вторая линия
 * (колбэк сохранения) проверяет статус зарегистрированных редакторов.
 */
const OFFICE_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ERROR_EVERY_MS = 60_000;

@Injectable()
export class OfficeSessionsStore {
  private lastErrorAt = 0;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OfficeSessionsStore.name);
  }

  private userKey(userId: string): string {
    return `nodus:office:sessions:${userId}`;
  }

  private documentKey(documentKey: string): string {
    return `nodus:office:documents:${documentKey}`;
  }

  /** Открыта сессия правки: запоминаем ключ документа и состав редакторов. */
  async register(userId: string, documentKey: string): Promise<void> {
    try {
      await runRedisCommand(this.redis, async () => {
        const pipeline = this.redis.pipeline();
        pipeline.sadd(this.userKey(userId), documentKey);
        pipeline.expire(this.userKey(userId), OFFICE_SESSION_TTL_SECONDS);
        pipeline.sadd(this.documentKey(documentKey), userId);
        pipeline.expire(this.documentKey(documentKey), OFFICE_SESSION_TTL_SECONDS);
        await pipeline.exec();
      });
    } catch (error) {
      this.errorThrottled(error);
    }
  }

  /** Ключи документов, открытых пользователем в режиме правки. */
  async keysOf(userId: string): Promise<string[]> {
    return runRedisCommand(this.redis, () => this.redis.smembers(this.userKey(userId)));
  }

  /** Все пользователи, открывавшие документ в режиме правки (для колбэка). */
  async editorsOf(documentKey: string): Promise<string[]> {
    return runRedisCommand(this.redis, () => this.redis.smembers(this.documentKey(documentKey)));
  }

  /**
   * Забыть ключи пользователя после `drop`. Членство в `documents:<key>` НЕ
   * снимаем: вторая линия (колбэк) должна видеть, что в документе были
   * уволенные, даже если drop не удался. Set документа живёт TTL и не растёт
   * без границ.
   */
  async clear(userId: string): Promise<void> {
    await runRedisCommand(this.redis, () => this.redis.del(this.userKey(userId)));
  }

  private errorThrottled(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorAt < ERROR_EVERY_MS) return;
    this.lastErrorAt = now;
    this.logger.warn(
      { err: error },
      'office sessions: Redis недоступен, сессия не попала в реестр drop',
    );
  }
}
