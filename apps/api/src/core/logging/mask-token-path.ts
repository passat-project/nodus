/**
 * Маскирование одноразовых токенов в путях логов и аудита (#101, O6):
 * ссылки приглашения/сброса несут сырой токен в URL. В access-логах и
 * `audit_logs.details.path` он не нужен — заменяем сегмент после
 * `/invitations/` и `/password-resets/` на `[redacted]`.
 *
 * Идемпотентно: повторная маскировка уже скрытого пути ничего не меняет.
 */
const TOKEN_SEGMENT = /(\/(?:api\/v1\/)?(?:invitations|password-resets)\/)([^/?#]+)/g;

export function maskTokenPath(path: string): string {
  return path.replace(TOKEN_SEGMENT, '$1[redacted]');
}
