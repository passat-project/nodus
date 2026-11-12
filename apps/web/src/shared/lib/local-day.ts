/**
 * Локальные календарные границы (#782): «день» пользователя — по поясу
 * браузера/ОС, а не UTC. UTC-нарезка (`iso.slice(0, 10)`) в Минске (UTC+3)
 * относила сообщения 00:00–03:00 к предыдущему дню: после 03:00 ночное
 * сообщение показывалось как «Вчера».
 */

/** Порядковый номер локального дня (UTC-конструктор — стабильный счётчик
 *  без DST-скачков: каждая локальная дата уникальна). */
export function localDayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/** Разница локальных календарных дней: 0 — сегодня, 1 — вчера, −1 — завтра. */
export function localDayDiff(iso: string, now: Date = new Date()): number {
  return localDayNumber(now) - localDayNumber(new Date(iso));
}
