/**
 * Часовой пояс компании (#55, F7): границы года и дата регистрации считаются
 * по Минску, а не по UTC сервера. 31.12 23:30 UTC — это уже 1 января в
 * Минске: номер должен уйти в новый год, а «дата регистрации» — быть 01.01.
 *
 * Функции чистые: пояс передаётся аргументом (тесты не зависят от env),
 * умолчание берётся из `COMPANY_TIMEZONE` (валидируется схемой окружения).
 */

/** Пояс компании по умолчанию (Беларусь, без перехода на летнее время). */
export const DEFAULT_COMPANY_TIMEZONE = 'Europe/Minsk';

/** Пояс компании из окружения; пустая строка шаблона = умолчание. */
export function companyTimeZone(source: NodeJS.ProcessEnv = process.env): string {
  return source.COMPANY_TIMEZONE?.trim() || DEFAULT_COMPANY_TIMEZONE;
}

/** Части даты в поясе компании: Intl без внешних зависимостей. */
function companyParts(at: Date, timeZone: string): { year: number; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return { year: Number(pick('year')), month: pick('month'), day: pick('day') };
}

/** Год по поясу компании — ось счётчика номеров. */
export function companyYear(at: Date, timeZone: string = companyTimeZone()): number {
  return companyParts(at, timeZone).year;
}

/** Месяц по поясу компании (1–12) — период «в каждом месяце» у серий (#630). */
export function companyMonth(at: Date, timeZone: string = companyTimeZone()): number {
  return Number(companyParts(at, timeZone).month);
}

/** Дата по поясу компании в формате YYYY-MM-DD (дата регистрации письма). */
export function companyDate(at: Date, timeZone: string = companyTimeZone()): string {
  const { year, month, day } = companyParts(at, timeZone);
  return `${String(year).padStart(4, '0')}-${month}-${day}`;
}
