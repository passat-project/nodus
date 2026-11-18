import { ASSISTANT_LIMITS, type Paginated } from '@nodus/contracts';

/**
 * Компактные проекции ответов API для промпта (ADR-0043: «списки — до 20
 * строк, без сырых JSON-простыней, обрезка по знакам с пометкой»). Модель
 * должна видеть факты, а не весь DTO: точность выбора и цена контекста.
 *
 * Все функции терпимы к отсутствующим полям (API развивается, моки старые):
 * неизвестное значение даёт «—», а не падение инструмента.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Типизированный охранник границы (#918): ответ API приводится к типу
 * контракта только после проверки «это объект». Дальше проекция читает поля
 * типизированно — переименование DTO ломает компиляцию (ADR-0049), а мусор с
 * границы по-прежнему даёт `null`, а не падение прогона.
 */
export function asTyped<T>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Элементы страницы `{ items, nextCursor }` с охранником границы: пустое или
 * не-JSON тело 200 (`parseBody` → null) не роняет прогон `TypeError`, а даёт
 * пустой список (ADR-0049). Тип `Paginated<T>` держит компиляцию: переименование
 * `items` в контракте ломает tsc.
 */
export function pageItems<T>(page: Paginated<T> | null | undefined): T[] {
  const rows = asTyped<Paginated<T>>(page)?.items;
  return asArray(rows)
    .map((raw) => asTyped<T>(raw))
    .filter((row): row is T => row !== null);
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Список из ответа `{ items, nextCursor }` (канон пагинации). */
export function itemsOf(data: unknown): unknown[] {
  return asArray(asRecord(data)?.items);
}

/**
 * Токен следующей страницы из канона `{ items, nextCursor }` (#938): модель
 * получает его в тексте и продолжает список тем же инструментом, а не
 * перебирает сущности по id.
 */
export function nextCursor(data: unknown): string | null {
  return str(asRecord(data)?.nextCursor);
}

/** Есть ли следующая страница — модели полезно знать, что список неполный. */
export function hasMore(data: unknown): boolean {
  return nextCursor(data) !== null;
}

const MONTHS = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
] as const;

/** Дата ISO → «14 ноя 2026» (без времени; понятнее модели, чем ISO). */
export function date(iso: unknown): string | null {
  const value = str(iso);
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

/** Дата и время ISO → «14 ноя 2026, 15:30» (UTC — единица хранения). */
export function dateTime(iso: unknown): string | null {
  const value = str(iso);
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const hh = String(parsed.getUTCHours()).padStart(2, '0');
  const mm = String(parsed.getUTCMinutes()).padStart(2, '0');
  return `${date(value)}, ${hh}:${mm}`;
}

/** Просрочен ли срок (только для активных сущностей — решает вызывающий). */
export function isOverdue(deadline: unknown, now = Date.now()): boolean {
  const value = str(deadline);
  if (!value) return false;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed < now;
}

/** Имя из ссылки `{ displayName }` / `{ name }` / строки. */
export function nameOf(value: unknown): string | null {
  if (typeof value === 'string') return str(value);
  const record = asRecord(value);
  if (!record) return null;
  return str(record.displayName) ?? str(record.name) ?? str(record.title);
}

/** Обрезка текста по лимиту с честной пометкой «сокращено». */
export function clip(text: string, limit = 400): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trimEnd()}… [сокращено]`;
}

/**
 * Блок списка: заголовок с количеством, до `maxRows` строк, пометка о
 * скрытом остатке. `total` — сколько всего нашлось (если API знает).
 */
export function listBlock(
  title: string,
  rows: readonly string[],
  options: { total?: number; maxRows?: number; more?: boolean; cursor?: string | null } = {},
): string {
  const maxRows = options.maxRows ?? ASSISTANT_LIMITS.maxListRows;
  const shown = rows.slice(0, maxRows);
  const total = options.total ?? rows.length;
  const head = `${title}: ${total}`;
  if (shown.length === 0) return `${head}\n(пусто)`;
  const rest = total - shown.length;
  const lines = shown.map((row, index) => `${index + 1}. ${row}`);
  if (rest > 0) lines.push(`… ещё ${rest}`);
  else if (options.more) {
    lines.push(
      options.cursor
        ? `… есть следующая страница; cursor: ${options.cursor}`
        : '… есть следующая страница (cursor)',
    );
  }
  return [head, ...lines].join('\n');
}

/** Итоговое ограничение размера результата инструмента (лимит прогона). */
export function finalize(text: string): string {
  if (text.length <= ASSISTANT_LIMITS.maxToolResultChars) return text;
  return `${text.slice(0, ASSISTANT_LIMITS.maxToolResultChars - 40).trimEnd()}\n… [сокращено по лимиту]`;
}

/** Ссылка «Открыть» на карточку сущности (внутренний адрес портала). */
export function entityLink(kind: string, id: string, label: string) {
  return { href: `?cards=${kind}:${id}`, label };
}
