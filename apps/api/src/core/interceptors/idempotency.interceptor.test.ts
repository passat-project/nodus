import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../errors/domain-exception.js';
import { REDIS_COMMAND_TIMEOUT_MS } from '../redis/redis-command.js';
import { IdempotencyInterceptor, isIdempotencyExcluded } from './idempotency.interceptor.js';
import { sha256Hex, stableStringify } from './stable-stringify.js';

function createContext(options: {
  method?: string;
  url?: string;
  body?: unknown;
  key?: string;
  statusCode?: number;
}) {
  const reply = {
    statusCode: options.statusCode ?? 201,
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: options.method ?? 'POST',
        url: options.url ?? '/api/v1/tasks',
        headers: options.key ? { 'idempotency-key': options.key } : {},
        body: options.body ?? { title: 'Задача' },
      }),
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;
  return { context, reply };
}

function createNext(body: unknown = { id: 't1' }): CallHandler {
  return { handle: () => of(body) };
}

function createRedis() {
  const pipeline = {
    set: vi.fn().mockReturnThis(),
    del: vi.fn().mockReturnThis(),
    eval: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  return {
    status: 'ready',
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    eval: vi.fn().mockResolvedValue(1),
    pipeline: vi.fn().mockReturnValue(pipeline),
    _pipeline: pipeline,
  };
}

const KEY = 'client-key-1';
const BODY = { title: 'Задача' };
const SCOPED = `nodus:core:idempotency:anonymous:POST:/api/v1/tasks:${sha256Hex(KEY)}`;

let redis: ReturnType<typeof createRedis>;
let interceptor: IdempotencyInterceptor;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  redis = createRedis();
  const logger = { setContext: vi.fn(), warn: vi.fn(), error: vi.fn() };
  interceptor = new IdempotencyInterceptor(redis as never, logger as never);
});

describe('IdempotencyInterceptor', () => {
  it('пути /api/v1/auth/* не кэшируются: TTL реплея 24ч >> жизни токена 15мин', async () => {
    const { context, reply } = createContext({
      url: '/api/v1/auth/login',
      key: 'fixed-key',
      body: { email: 'a@b.c', password: 'x' },
    });
    await expect(
      lastValueFrom(await interceptor.intercept(context, createNext({ accessToken: 'jwt' }))),
    ).resolves.toEqual({ accessToken: 'jwt' });
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(reply.header).not.toHaveBeenCalled();
  });

  it('GET-запросы проходят мимо механизма', async () => {
    const { context } = createContext({ method: 'GET', key: KEY });
    const next = createNext();
    await interceptor.intercept(context, next);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('без заголовка Idempotency-Key — мимо механизма', async () => {
    const { context } = createContext({});
    await interceptor.intercept(context, createNext());
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('replay: тот же ключ и тело → первый ответ с Idempotent-Replay', async () => {
    const cached = {
      body: { id: 't1' },
      bodyHash: sha256Hex(stableStringify(BODY)),
    };
    redis.get.mockResolvedValue(JSON.stringify(cached));
    const { context, reply } = createContext({ key: KEY, body: BODY });
    const next = createNext({ id: 't2' }); // не должен быть вызван

    const result$ = await interceptor.intercept(context, next);
    expect(await lastValueFrom(result$)).toEqual({ id: 't1' });
    expect(reply.header).toHaveBeenCalledWith('Idempotent-Replay', 'true');
    // Статус вручную не выставляем — его применит Nest по метаданным маршрута.
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('тот же ключ с иным телом → CONFLICT и продление TTL', async () => {
    const cached = { body: {}, bodyHash: sha256Hex('{"other":true}') };
    redis.get.mockResolvedValue(JSON.stringify(cached));
    const { context } = createContext({ key: KEY, body: BODY });

    await expect(interceptor.intercept(context, createNext())).rejects.toSatisfy(
      (error: unknown) => error instanceof DomainException && error.code === ErrorCode.CONFLICT,
    );
    expect(redis.expire).toHaveBeenCalledWith(SCOPED, 86400);
  });

  it('первый запрос: исполняется и кэширует 2xx-ответ', async () => {
    const { context } = createContext({ key: KEY, body: BODY });
    const result$ = await interceptor.intercept(context, createNext({ id: 't1' }));
    expect(await lastValueFrom(result$)).toEqual({ id: 't1' });
    expect(redis.set).toHaveBeenCalledWith(`${SCOPED}:lock`, expect.any(String), 'PX', 5000, 'NX');
    const token = redis.set.mock.calls[0]![1] as string;
    expect(redis.pipeline).toHaveBeenCalled();
    expect(redis._pipeline.set).toHaveBeenCalledWith(
      SCOPED,
      expect.stringContaining('"bodyHash"'),
      'EX',
      86400,
    );
    // замок снимается только по своему токену (compare-and-del)
    expect(redis._pipeline.eval).toHaveBeenCalledWith(
      expect.stringContaining("'del'"),
      1,
      `${SCOPED}:lock`,
      token,
    );
  });

  it('долгий хендлер: замок продлевается heartbeat-ом по токену, после ответа — стоп', async () => {
    vi.useFakeTimers();
    const handler$ = new Subject<unknown>();
    const { context } = createContext({ key: KEY, body: BODY });
    const result$ = await interceptor.intercept(context, { handle: () => handler$ });
    const done = lastValueFrom(result$);
    const token = redis.set.mock.calls[0]![1] as string;

    await vi.advanceTimersByTimeAsync(4_600); // три тика heartbeat (1.5 с)
    const extendCalls = redis.eval.mock.calls.filter((c) => String(c[0]).includes('pexpire'));
    expect(extendCalls).toHaveLength(3);
    expect(extendCalls[0]).toEqual([expect.any(String), 1, `${SCOPED}:lock`, token, 5000]);

    handler$.next({ id: 't1' });
    handler$.complete();
    await expect(done).resolves.toEqual({ id: 't1' });
    redis.eval.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('ошибка хендлера: замок снимается по своему токену, ответ не кэшируется', async () => {
    const { context } = createContext({ key: KEY, body: BODY });
    const result$ = await interceptor.intercept(context, {
      handle: () => throwError(() => new Error('boom')),
    });
    await expect(lastValueFrom(result$)).rejects.toThrow('boom');
    const token = redis.set.mock.calls[0]![1] as string;
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("'del'"),
      1,
      `${SCOPED}:lock`,
      token,
    );
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it('повтор при чужом живом замке: ждёт 2 с и отвечает CONFLICT in_progress, хендлер не исполняет', async () => {
    vi.useFakeTimers();
    redis.set.mockResolvedValue(null); // замок держит оригинал (heartbeat)
    const handle = vi.fn(() => of({ id: 'dup' }));
    const { context } = createContext({ key: KEY, body: BODY });

    const pending = interceptor.intercept(context, { handle });
    const assertion = expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof DomainException &&
        error.code === ErrorCode.CONFLICT &&
        error.details?.reason === 'in_progress',
    );
    await vi.advanceTimersByTimeAsync(2_200);
    await assertion;
    expect(handle).not.toHaveBeenCalled();
  });

  it('повтор при чужом замке: результат появился в ожидании → реплей без исполнения', async () => {
    vi.useFakeTimers();
    const cached = { body: { id: 't1' }, bodyHash: sha256Hex(stableStringify(BODY)) };
    redis.set.mockResolvedValue(null);
    redis.get
      .mockResolvedValueOnce(null) // до замка
      .mockResolvedValueOnce(null) // первый опрос
      .mockResolvedValue(JSON.stringify(cached));
    const handle = vi.fn(() => of({ id: 'dup' }));
    const { context, reply } = createContext({ key: KEY, body: BODY });

    const pending = interceptor.intercept(context, { handle });
    await vi.advanceTimersByTimeAsync(300);
    expect(await lastValueFrom(await pending)).toEqual({ id: 't1' });
    expect(reply.header).toHaveBeenCalledWith('Idempotent-Replay', 'true');
    expect(handle).not.toHaveBeenCalled();
  });

  it('оригинал упал (замок исчез без результата) → повтор берёт замок и исполняется', async () => {
    vi.useFakeTimers();
    redis.set.mockResolvedValueOnce(null).mockResolvedValue('OK');
    const handle = vi.fn(() => of({ id: 't2' }));
    const { context } = createContext({ key: KEY, body: BODY });

    const pending = interceptor.intercept(context, { handle });
    await vi.advanceTimersByTimeAsync(150);
    expect(await lastValueFrom(await pending)).toEqual({ id: 't2' });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('недоступный Redis → fail-open, запрос исполняется', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    const { context } = createContext({ key: KEY, body: BODY });
    const result$ = await interceptor.intercept(context, createNext({ id: 't9' }));
    expect(await lastValueFrom(result$)).toEqual({ id: 't9' });
  });

  it('Redis не готов → fail-open, команда не вызывается', async () => {
    redis.status = 'reconnecting';
    const { context } = createContext({ key: KEY, body: BODY });
    const result$ = await interceptor.intercept(context, createNext({ id: 't9' }));
    expect(await lastValueFrom(result$)).toEqual({ id: 't9' });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('Redis завис → fail-open по таймауту', async () => {
    vi.useFakeTimers();
    redis.get.mockReturnValue(new Promise(() => undefined));
    const { context } = createContext({ key: KEY, body: BODY });
    const pending = interceptor.intercept(context, createNext({ id: 't9' }));
    await vi.advanceTimersByTimeAsync(REDIS_COMMAND_TIMEOUT_MS);
    const result$ = await pending;
    expect(await lastValueFrom(result$)).toEqual({ id: 't9' });
  });

  it('маршруты с сырым одноразовым токеном не кэшируются в Redis (#101)', async () => {
    for (const url of [
      '/api/v1/directory/invitations',
      '/api/v1/directory/invitations/11111111-1111-4111-8111-111111111111/reissue',
      '/api/v1/directory/users/11111111-1111-4111-8111-111111111111/password-reset',
    ]) {
      redis.get.mockClear();
      const { context } = createContext({ url, key: KEY, body: BODY });
      const result$ = await interceptor.intercept(context, createNext({ id: 'u1', token: 'raw' }));
      expect(await lastValueFrom(result$)).toEqual({ id: 'u1', token: 'raw' });
      expect(redis.get).not.toHaveBeenCalled();
      expect(isIdempotencyExcluded(url)).toBe(true);
    }
    expect(isIdempotencyExcluded('/api/v1/tasks')).toBe(false);
  });
});
