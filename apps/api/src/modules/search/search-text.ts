import { escapeLikePattern } from '../../core/database/like-pattern.js';

/**
 * Подготовка текста поисковой проекции (#952, Р8/Р15).
 *
 * - C0-управляющие символы (кроме `\n`/`\t`) вырезаются ДО записи в индекс:
 *   маркеры подсветки сниппета — это U+0001/U+0002, и сообщение чата с таким
 *   символом иначе сломало бы рендер фронта (чат допускает любые строки).
 * - title ≤ 500, body ≤ 4000 с многоточием: длинный body (описание задачи)
 *   не раздувает GIN и `ts_headline`.
 * - LIKE-шаблоны экранируют `%`/`_`/`\` (F1): поиск «%» — литерал.
 */

/** C0 без перевода строки и табуляции (U+0009/U+000A). */
export function sanitizeSearchText(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    // C0-управляющие, кроме \t (0x09) и \n (0x0A). Регулярка с явными
    // control-символами запрещена линтером (no-control-regex) — обход по коду.
    result += code < 0x20 && code !== 0x09 && code !== 0x0a ? ' ' : char;
  }
  return result;
}

/** Убирает управляющие символы и ограничивает длину (многоточие — знак обрезки). */
export function clampSearchText(value: string, max: number): string {
  const text = sanitizeSearchText(value).trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Префиксный LIKE: `q` → `q%` с экранированными метасимволами. */
export function likePrefixPattern(query: string): string {
  return `${escapeLikePattern(query)}%`;
}

/** Цифры номера для точной ноги: «ПП-123»/«123» → «123», иначе null. */
export function digitsOf(query: string): string | null {
  const compact = query.replace(/^ПП[-\s]*/iu, '').trim();
  return /^\d{1,12}$/u.test(compact) ? compact : null;
}

/**
 * Окно сниппета для exact/trigram-ног (#952, Р8): ±80 символов вокруг
 * первого вхождения слова запроса, маркеры `\u0001`/`\u0002`. Опечатка не
 * находится буквально — тогда отдаём начало текста без подсветки (строка
 * всё равно помечена «похоже на»).
 */
export function snippetAround(text: string, query: string, radius = 80): string {
  const clean = sanitizeSearchText(text).replace(/\s+/gu, ' ').trim();
  if (clean === '') return '';
  const lower = clean.toLocaleLowerCase('ru');
  let at = -1;
  let length = 0;
  for (const token of query.toLocaleLowerCase('ru').split(/\s+/u)) {
    if (token.length < 2) continue;
    const found = lower.indexOf(token);
    if (found >= 0 && (at < 0 || found < at)) {
      at = found;
      length = token.length;
    }
  }
  const start = at < 0 ? 0 : Math.max(0, at - radius);
  const end =
    at < 0 ? Math.min(clean.length, radius * 2) : Math.min(clean.length, at + length + radius);
  const core = clean.slice(start, end);
  const body =
    at < 0
      ? core
      : `${core.slice(0, at - start)}\u0001${core.slice(at - start, at - start + length)}\u0002${core.slice(at - start + length)}`;
  return `${start > 0 ? '…' : ''}${body}${end < clean.length ? '…' : ''}`;
}
