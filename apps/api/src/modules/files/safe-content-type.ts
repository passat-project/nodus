/**
 * `Content-Type` для ответа с файлом: mime приходит от клиента (multipart)
 * и не валидируется. Управляющие символы в значении заголовка роняют
 * `writeHead`/`setHeader` (`ERR_INVALID_CHAR`) — ответ на HEAD/GET не уходит
 * вовсе, а многокилобайтная строка делает файл незагружаемым для клиентов
 * (security-ревью #1005).
 *
 * Пропускаем только форму `type/subtype` с печатными параметрами и длиной
 * до 128 символов; всё остальное — `application/octet-stream`.
 */
export const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

/** Потолок Content-Type: стандартные типы с параметрами укладываются с запасом. */
export const MAX_CONTENT_TYPE_LENGTH = 128;

const MIME_PATTERN = /^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:\s*;\s*[\x20-\x7e]*)?$/i;

export function safeContentType(mime: string): string {
  return mime.length <= MAX_CONTENT_TYPE_LENGTH && MIME_PATTERN.test(mime)
    ? mime
    : FALLBACK_CONTENT_TYPE;
}
