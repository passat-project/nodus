/**
 * Разбор заголовка `Range` для отдачи контента файла (#1005).
 *
 * Браузерные `<video>`/`<audio>` перематывают только те ресурсы, которые
 * сервер умеет отдавать кусками: Chrome/WebKit считают поток без `206` и
 * `Accept-Ranges` не-seekable до полной загрузки (Safari без 206 вообще не
 * воспроизводит). Здесь — чистая часть решения: что именно читать из
 * хранилища; HTTP-статусы/заголовки собирает контроллер.
 *
 * Правила (RFC 9110 §14):
 * - поддерживается ОДИН диапазон (`bytes=start-end`, `bytes=start-`,
 *   `bytes=-suffix`); многодиапазонный ответ (multipart/byteranges) браузерам
 *   не нужен — отдаём весь файл;
 * - негодный синтаксис/единица измерения — тоже весь файл (сервер ВПРАВЕ
 *   игнорировать `Range`);
 * - диапазон, не пересекающий файл (start ≥ size, end < start, суффикс 0),
 *   — `unsatisfiable` (416, `Content-Range` с полным размером ресурса);
 * - конец за размером файла обрезается до последнего байта (RFC: «interpreted
 *   as the remainder»).
 */
export interface ByteRange {
  /** Первый байт (включительно). */
  start: number;
  /** Последний байт (включительно). */
  end: number;
}

export type RangeDecision =
  /** Диапазон не запрошен/негоден — отдаём представление целиком (200). */
  | { kind: 'full' }
  /** Читаем только срез из хранилища (206). */
  | { kind: 'partial'; range: ByteRange }
  /** Диапазон вне файла — 416. */
  | { kind: 'unsatisfiable' };

/** Число из цифровой части заголовка; нечисло/переполнение — null. */
function finiteIndex(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Решение по `Range` для файла известного размера. `size <= 0` + любой
 * диапазон — `unsatisfiable` (пустое представление не имеет байтов).
 */
export function decideContentRange(header: string | undefined, size: number): RangeDecision {
  if (!header) return { kind: 'full' };
  const unit = /^bytes=(.+)$/i.exec(header.trim());
  if (!unit) return { kind: 'full' };
  const spec = unit[1]!.trim();
  // Многодиапазонные запросы не поддерживаем (браузеры их не шлют).
  if (spec.includes(',')) return { kind: 'full' };
  const parts = /^(?<start>\d*)-(?<end>\d*)$/.exec(spec);
  if (!parts?.groups) return { kind: 'full' };
  const rawStart = parts.groups.start ?? '';
  const rawEnd = parts.groups.end ?? '';
  if (rawStart === '' && rawEnd === '') return { kind: 'full' };
  if (size <= 0) return { kind: 'unsatisfiable' };

  // `bytes=-N` — последние N байт; N больше файла = весь файл.
  if (rawStart === '') {
    const suffix = finiteIndex(rawEnd);
    if (suffix === null) return { kind: 'full' };
    if (suffix === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', range: { start: Math.max(0, size - suffix), end: size - 1 } };
  }

  const start = finiteIndex(rawStart);
  if (start === null) return { kind: 'full' };
  if (start >= size) return { kind: 'unsatisfiable' };
  if (rawEnd === '') return { kind: 'partial', range: { start, end: size - 1 } };

  const requestedEnd = finiteIndex(rawEnd);
  if (requestedEnd === null) return { kind: 'full' };
  if (requestedEnd < start) return { kind: 'unsatisfiable' };
  return { kind: 'partial', range: { start, end: Math.min(requestedEnd, size - 1) } };
}
