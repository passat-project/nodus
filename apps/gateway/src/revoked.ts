import type { Redis } from 'ioredis';

/** Тот же ключ, что пишет `RevokedUsersStore` apps/api (#333): момент в
 *  секундах epoch, токены с `iat` не позже него отозваны. */
const KEY_PREFIX = 'nodus:auth:revoked-before:';
/** Потолок горячего пути хендшейка: Redis не должен вешать подключение. */
const COMMAND_TIMEOUT_MS = 300;

export type TokenRevokedChecker = (
  userId: string,
  issuedAtSeconds: number | undefined,
) => Promise<boolean>;

/**
 * Стоп-лист access-токенов на хендшейке gateway (#101): после деактивации,
 * смены ролей и выпуска reset-ссылки API пишет в Redis `revoked-before:userId`.
 * Без этой проверки сокет переподключался бы старым access-токеном (до 15 мин),
 * хотя HTTP уже отвечает 401.
 *
 * Клиент обязан быть НЕблокирующим (отдельное соединение): fanout занят
 * `XREADGROUP BLOCK 5s`, и проверка на нём ждала бы остаток блокировки.
 * Redis не ready или не ответил за 300 мс — fail-open (портал не встаёт), лог;
 * остаточный риск ограничен TTL access-токена, статус учётки всё равно
 * проверяется отдельным SELECT.
 */
export function createTokenRevokedChecker(redis: Redis): TokenRevokedChecker {
  return async (userId, issuedAtSeconds) => {
    if (redis.status !== 'ready') return false;
    let timer: NodeJS.Timeout | undefined;
    try {
      const raw = await Promise.race([
        redis.get(`${KEY_PREFIX}${userId.toLowerCase()}`),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), COMMAND_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
      if (raw === null) return false;
      return issuedAtSeconds === undefined || issuedAtSeconds <= Number(raw);
    } catch (error) {
      console.error('[gateway] revoked-before check failed:', error);
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
