import { CSV_EXPORT } from '@nodus/contracts';

/**
 * CSV выгрузки списков (#435): русский Excel — UTF-8 c BOM, разделитель
 * «;», кавычка по RFC 4180, переводы строк CRLF. Чистая функция: сборка
 * строк — у источника сущности, здесь только формат.
 */

/** Ячейка CSV: пустая — пусто, число — без кавычек, текст — в кавычках
 * при любом спецсимволе; `"` удваивается (RFC 4180). Строка с ведущими
 * `= + - @` или табуляцией — формулоопасна (OWASP CSV injection): Excel
 * исполнил бы её формулой и после кавычек, поэтому префиксуем апострофом.
 * Числа (включая отрицательные) безопасны и остаются числами. */
export function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatNumber(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[;"\r\n]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

/** Число без экспоненциальной записи (Excel так читает надёжнее). */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  return String(value);
}

/** Полный CSV: BOM + строки, разделитель «;», CRLF. */
export function buildCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): string {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(CSV_EXPORT.delimiter));
  return `${CSV_EXPORT.bom}${lines.join('\r\n')}\r\n`;
}
