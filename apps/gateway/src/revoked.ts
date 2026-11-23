import type { Redis } from 'ioredis';

/** Тот же ключ, что пишет `RevokedUsersStore` apps/api (#333): момент в
 *  секундах epoch, токены с `iat` не позже него отозваны. */
const KEY_PREFIX = 'nodus:auth:revoked-before:';

export type TokenRevokedChecker = (
  userId: string,
  issuedAtSeconds: number | undefined,
) => Promise<boolean>;

/**
 * Стоп-лист access-токенов на хендшейке gateway (#101): после деактивации,
 * смены ролей и выпуска reset-ссылки API пишет в Redis `revoked-before:userId`.
 * Без этой проверки сокет переподключался бы старым access-токеном (до 15 мин),
 * хотя HTTP уже отвечает 401. Недоступный Redis — fail-open (портал не встаёт),
 * лог `error`; остаточный риск ограничен TTL access-токена, статус учётки всё
 * равно проверяется отдельным SELECT.
 */
export function createTokenRevokedChecker(redis: Redis): TokenRevokedChecker {
  return async (userId, issuedAtSeconds) => {
    try {
      const raw = await redis.get(`${KEY_PREFIX}${userId.toLowerCase()}`);
      if (raw === null) return false;
      return issuedAtSeconds === undefined || issuedAtSeconds <= Number(raw);
    } catch (error) {
      console.error('[gateway] revoked-before check failed:', error);
      return false;
    }
  };
}
