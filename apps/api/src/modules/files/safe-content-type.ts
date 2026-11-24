/**
 * `Content-Type` для ответа с файлом: mime приходит от клиента (multipart)
 * и не валидируется, а управляющие символы в значении заголовка роняют
 * `writeHead`/`setHeader` (`ERR_INVALID_CHAR`) — ответ на HEAD/GET не уходит
 * вовсе (security-ревью #1005). Непечатаемое/пустое — отдаём как поток байтов.
 *
 * Разрешён печатный ASCII (`0x20–0x7E`, включая параметры вида
 * `text/plain; charset=utf-8`); всё остальное — `application/octet-stream`.
 */
export const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

export function safeContentType(mime: string): string {
  return /^[\x20-\x7e]+$/.test(mime) ? mime : FALLBACK_CONTENT_TYPE;
}
