import { Redis, type RedisOptions } from 'ioredis';

const ERROR_LOG_INTERVAL_MS = 30_000;

/**
 * Именованное соединение gateway (#507): имя видно в `CLIENT LIST`, ошибки —
 * одной строкой не чаще раза в 30 с. Без heartbeat: клиент занят
 * `XREADGROUP BLOCK`, PING встал бы за блокировкой (Docker Desktop рвёт idle
 * TCP ~40 с — там, где соединение не блокирующее, heartbeat нужен).
 * `options` — для отдельного НЕблокирующего клиента (auth-проверки хендшейка).
 */
export function createGatewayRedis(
  url: string,
  name = 'gateway:fanout',
  options: Partial<RedisOptions> = {},
): Redis {
  const client = new Redis(url, {
    connectionName: name,
    maxRetriesPerRequest: null,
    ...options,
  });
  // По коду ошибки, а не по клиенту: auth-ошибка не должна тонуть в шторме (#507).
  const lastLoggedAt = new Map<string, number>();
  client.on('error', (error: Error & { code?: string }) => {
    const key = error.code ?? error.message;
    const now = Date.now();
    if (now - (lastLoggedAt.get(key) ?? 0) < ERROR_LOG_INTERVAL_MS) return;
    lastLoggedAt.set(key, now);
    console.error(
      `[gateway] Redis "${name}": ${error.message}${error.code ? ` (${error.code})` : ''}`,
    );
  });
  return client;
}
