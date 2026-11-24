/**
 * Имя файла для хранения и заголовка `Content-Disposition` (#1005,
 * security-ревью): multipart-имя приходит от клиента без ограничения длины,
 * а `encodeURIComponent` в заголовке раздувает его ещё до ~3×. Гигантский
 * заголовок клиенты отбрасывают (`ERR_RESPONSE_HEADERS_TOO_BIG`) — файл
 * становится незагружаемым для всех получателей.
 *
 * Управляющие символы и одиночные суррогаты вырезаем (иначе
 * `encodeURIComponent` бросает `URIError`), длину ограничиваем 200 символами,
 * обрезая по код-пойнтам (эмодзи не разрывается); расширение сохраняем — по
 * нему выбираются иконка/просмотрщик.
 */
export const MAX_FILE_NAME_LENGTH = 200;

/** Имя для файла, у которого после санитизации ничего не осталось. */
export const FALLBACK_FILE_NAME = 'файл';

/** Расширение, которое стоит сохранить при обрезке (`.tar.gz` и т.п. — до 11). */
const MAX_EXTENSION_LENGTH = 11;

/** Печатный символ: не управляющий, не DEL, не суррогат и не bidi-управление. */
function isSafeCodePoint(code: number): boolean {
  if (code < 0x20 || code === 0x7f) return false;
  if (code >= 0xd800 && code <= 0xdfff) return false;
  // Невидимые RTL/LTR-переопределения подменяют расширение в отображении
  // («счёт<RTL>fdp.exe» читается как «счётexe.pdf», CWE-451).
  if (code === 0x061c || code === 0x200e || code === 0x200f) return false;
  if (code >= 0x202a && code <= 0x202e) return false;
  if (code >= 0x2066 && code <= 0x2069) return false;
  return true;
}

export function safeFileName(name: string, max = MAX_FILE_NAME_LENGTH): string {
  let clean = '';
  for (const char of name) {
    if (isSafeCodePoint(char.codePointAt(0) ?? 0)) clean += char;
  }
  clean = clean.trim();
  if (clean.length === 0) return FALLBACK_FILE_NAME;
  if (clean.length <= max) return clean;

  const dot = clean.lastIndexOf('.');
  const extension = dot > 0 && clean.length - dot <= MAX_EXTENSION_LENGTH ? clean.slice(dot) : '';
  const base = extension ? clean.slice(0, dot) : clean;
  // Режем по код-пойнтам, не превышая бюджет UTF-16: `slice` по единицам
  // разрывал суррогатную пару → URIError в encodeURIComponent.
  const budget = Math.max(0, max - extension.length);
  let truncated = '';
  for (const char of base) {
    if (truncated.length + char.length > budget) break;
    truncated += char;
  }
  return `${truncated}${extension}`;
}
