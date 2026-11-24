/**
 * Имя файла для хранения и заголовка `Content-Disposition` (#1005,
 * security-ревью): multipart-имя приходит от клиента без ограничения длины,
 * а `encodeURIComponent` в заголовке раздувает его ещё до ~3×. Гигантский
 * заголовок клиенты отбрасывают (`ERR_RESPONSE_HEADERS_TOO_BIG`) — файл
 * становится незагружаемым для всех получателей.
 *
 * Управляющие символы вырезаем, длину ограничиваем 200 символами; расширение
 * сохраняем (по нему выбираются иконка/просмотрщик).
 */
export const MAX_FILE_NAME_LENGTH = 200;

/** Расширение, которое стоит сохранить при обрезке (`.tar.gz` и т.п. — до 11). */
const MAX_EXTENSION_LENGTH = 11;

export function safeFileName(name: string, max = MAX_FILE_NAME_LENGTH): string {
  // Управляющие символы убираем без regex: правило no-control-regex запрещено
  // отключать, а диапазон \\x00–\\x1f в литерале — именно оно.
  let clean = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) clean += char;
  }
  clean = clean.trim();
  if (clean.length <= max) return clean;
  const dot = clean.lastIndexOf('.');
  const extension = dot > 0 && clean.length - dot <= MAX_EXTENSION_LENGTH ? clean.slice(dot) : '';
  const base = extension ? clean.slice(0, dot) : clean;
  return `${base.slice(0, Math.max(0, max - extension.length))}${extension}`;
}
