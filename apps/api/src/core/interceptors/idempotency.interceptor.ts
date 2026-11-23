import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { defer, finalize, of, tap, type Observable } from 'rxjs';
import { ErrorCode, type AuthUser } from '@nodus/contracts';

import { REQUEST_USER_KEY } from '../decorators/get-user.decorator.js';
import { DomainException } from '../errors/domain-exception.js';
import { runRedisCommand } from '../redis/redis-command.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { sha256Hex, stableStringify } from './stable-stringify.js';

/** TTL сохранённого ответа и замка (ADR-0005). */
const RESPONSE_TTL_SECONDS = 86_400; // 24 ч
/** Замок живёт 5 с без продления: упавший процесс освобождает ключ сам. */
const LOCK_TTL_MS = 5_000;
/** Heartbeat продления замка, пока исполняется хендлер (≈ TTL/3 — переживает
 *  пропуск тика). Долгий запрос (multipart-аплоад) замок не теряет. */
const LOCK_HEARTBEAT_MS = 1_500;
const LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 100;

/** PEXPIRE только своего замка (токен владельца): чужой/протухший не трогаем. */
const EXTEND_LOCK_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0`;

/** DEL только своего замка: истёкший и перехваченный повтором замок не сносим. */
const RELEASE_LOCK_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Ответы auth не кэшируются: TTL реплея (24 ч) на порядки больше жизни
 * access-токена (15 мин) — реплей логина/refresh спустя время отдал бы
 * истёкший токен (найдено k6-прогоном #58). Повтор логина безопасен и без
 * идемпотентности (api-client генерирует уникальный ключ на вызов).
 */
const IDEMPOTENCY_EXCLUDED_PREFIXES = [
  '/api/v1/auth/',
  // Одноразовые ссылки (#101): сырой токен не должен лежать в Redis-кэше
  // идемпотентности 24 часа; accept одноразовый по CAS самого токена.
  '/api/v1/invitations/',
  '/api/v1/password-resets/',
];

/**
 * Админские маршруты, возвращающие СЫРОЙ одноразовый токен (#101): тело
 * ответа кэшировать нельзя — иначе действующий токен 7 дней/24 часа лежит
 * в Redis открытым текстом (ADR-0054 §8). Idempotency-Key у web-клиента есть
 * на каждой мутации, поэтому без исключения сюда попадали бы все выпуски.
 */
const IDEMPOTENCY_EXCLUDED_PATTERNS: readonly RegExp[] = [
  /^\/api\/v1\/directory\/invitations$/,
  /^\/api\/v1\/directory\/invitations\/[^/]+\/reissue$/,
  /^\/api\/v1\/directory\/users\/[^/]+\/password-reset$/,
];

/** Маршрут не кэшируется механизмом идемпотентности (экспорт — для тестов). */
export function isIdempotencyExcluded(path: string): boolean {
  return (
    IDEMPOTENCY_EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    IDEMPOTENCY_EXCLUDED_PATTERNS.some((pattern) => pattern.test(path))
  );
}

interface CachedResponse {
  body: unknown;
  bodyHash: string;
}

/**
 * Идемпотентность мутаций (I7, ADR-0005): повтор с тем же `Idempotency-Key`
 * и тем же телом получает первый ответ (заголовок `Idempotent-Replay: true`),
 * с иным телом — CONFLICT. Ключ скоуплен актором+методом+путём+sha256(key).
 * Гонки закрыты замком SET NX с токеном владельца; пока хендлер исполняется,
 * замок продлевается heartbeat-ом (PEXPIRE по токену). Повтор, заставший
 * чужой замок, ждёт результат до 2 с и затем отвечает CONFLICT «ещё
 * выполняется» (`details.reason = 'in_progress'`) — хендлер второй раз НЕ
 * исполняется (канон draft-ietf-httpapi-idempotency-key-header: 409 на
 * повтор во время обработки оригинала). Повтор исполняется, только если
 * замок исчез без результата (оригинал упал — ошибки не кэшируются) и
 * удалось взять его заново. Недоступный Redis — fail-open (запрос проходит,
 * защита временно ослаблена, в лог — warn).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IdempotencyInterceptor.name);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    if (!MUTATING_METHODS.has(request.method)) {
      return next.handle();
    }
    const path = request.url.split('?')[0] ?? request.url;
    if (isIdempotencyExcluded(path)) {
      return next.handle();
    }
    const keyHeader = request.headers['idempotency-key'];
    if (typeof keyHeader !== 'string' || keyHeader.length === 0) {
      return next.handle(); // заголовка нет — механизм не применяется
    }

    let scopedKey: string;
    let bodyHash: string;
    try {
      const user = (request as FastifyRequest & { [REQUEST_USER_KEY]?: AuthUser })[
        REQUEST_USER_KEY
      ];
      const actor = user?.id ?? 'anonymous';
      scopedKey = `nodus:core:idempotency:${actor}:${request.method}:${request.url.split('?')[0]}:${sha256Hex(keyHeader)}`;
      bodyHash = sha256Hex(stableStringify(request.body ?? null));
    } catch {
      return next.handle();
    }

    const lockKey = `${scopedKey}:lock`;
    const lockToken = randomUUID();
    try {
      const cached = await this.getCached(scopedKey);
      if (cached) {
        return this.replay(
          JSON.parse(cached) as CachedResponse,
          bodyHash,
          http.getResponse(),
          scopedKey,
        );
      }
      if (!(await this.tryLock(lockKey, lockToken))) {
        const appeared = await this.waitForResultOrLock(scopedKey, lockKey, lockToken);
        if (appeared !== null) {
          return this.replay(
            JSON.parse(appeared) as CachedResponse,
            bodyHash,
            http.getResponse(),
            scopedKey,
          );
        }
        // null — замок взят нами после падения оригинала: исполняемся.
      }
    } catch (error) {
      if (error instanceof DomainException) {
        throw error;
      }
      this.logger.warn({ err: error }, 'Idempotency store unavailable, failing open');
      return next.handle();
    }

    return defer(() => {
      const stopHeartbeat = this.startHeartbeat(lockKey, lockToken);
      return next.handle().pipe(
        tap({
          next: (body: unknown) => {
            // Успех обработчика (исключения уходят в ветку error) — кэшируем ответ.
            // Статус-код не храним: в интерсепторе он ещё не финальный (Nest применит
            // @HttpCode/дефолт 201 позже); при replay статус выставит сам Nest.
            const record: CachedResponse = { body, bodyHash };
            void runRedisCommand(this.redis, () =>
              this.redis
                .pipeline()
                .set(scopedKey, JSON.stringify(record), 'EX', RESPONSE_TTL_SECONDS)
                .eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken)
                .exec(),
            ).catch((error: unknown) =>
              this.logger.warn({ err: error }, 'Failed to cache idempotent response'),
            );
          },
          error: () => {
            void this.releaseLock(lockKey, lockToken);
          },
        }),
        finalize(stopHeartbeat),
      );
    });
  }

  /** Повтор с иным телом — CONFLICT с продлением TTL (переждать нельзя, ADR-0005). */
  private replay(
    cached: CachedResponse,
    bodyHash: string,
    reply: FastifyReply,
    scopedKey: string,
  ): Observable<unknown> {
    if (cached.bodyHash !== bodyHash) {
      void runRedisCommand(this.redis, () =>
        this.redis.expire(scopedKey, RESPONSE_TTL_SECONDS),
      ).catch(() => undefined);
      throw new DomainException(
        ErrorCode.CONFLICT,
        'Idempotency key was used with a different payload',
      );
    }
    // Статус НЕ выставляем вручную — финальный статус маршрута применит Nest.
    void reply.header('Idempotent-Replay', 'true');
    return of(cached.body);
  }

  private getCached(key: string): Promise<string | null> {
    return runRedisCommand(this.redis, () => this.redis.get(key));
  }

  private async tryLock(lockKey: string, token: string): Promise<boolean> {
    const result = await runRedisCommand(this.redis, () =>
      this.redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX'),
    );
    return result === 'OK';
  }

  private async releaseLock(lockKey: string, token: string): Promise<void> {
    await runRedisCommand(this.redis, () =>
      this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token),
    ).catch(() => undefined);
  }

  /**
   * Продление замка, пока хендлер исполняется. Потеря замка (истёк при сбое
   * Redis/подвисании цикла событий и перехвачен повтором) — warn и стоп:
   * исполнение уже не остановить, дубль страхуют ограничения БД.
   */
  private startHeartbeat(lockKey: string, token: string): () => void {
    const timer = setInterval(() => {
      runRedisCommand(this.redis, () =>
        this.redis.eval(EXTEND_LOCK_SCRIPT, 1, lockKey, token, LOCK_TTL_MS),
      )
        .then((extended) => {
          if (Number(extended) !== 1) {
            clearInterval(timer);
            this.logger.warn({ lockKey }, 'Idempotency lock lost while handler is running');
          }
        })
        .catch((error: unknown) => {
          this.logger.warn({ err: error }, 'Idempotency lock heartbeat failed');
        });
    }, LOCK_HEARTBEAT_MS);
    timer.unref();
    return () => {
      clearInterval(timer);
    };
  }

  /**
   * Ожидание повтора, заставшего чужой замок: результат появился → его
   * реплей; замок исчез без результата (оригинал упал) и взят нами → null
   * (исполняемся); оригинал всё ещё работает к дедлайну → CONFLICT «ещё
   * выполняется» — второй раз хендлер параллельно не исполняется.
   */
  private async waitForResultOrLock(
    scopedKey: string,
    lockKey: string,
    token: string,
  ): Promise<string | null> {
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
      const result = await this.getCached(scopedKey);
      if (result) {
        return result;
      }
      if (await this.tryLock(lockKey, token)) {
        // Замок свободен, но результат мог записаться между GET и SET NX.
        const late = await this.getCached(scopedKey);
        if (late) {
          await this.releaseLock(lockKey, token);
          return late;
        }
        return null;
      }
    }
    throw new DomainException(
      ErrorCode.CONFLICT,
      'A request with this idempotency key is still in progress',
      { reason: 'in_progress' },
    );
  }
}
