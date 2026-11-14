import type { MoneyValue } from '@nodus/contracts';
import { CUSTOM_FIELD_LIMITS, hasDecimalPrecision } from '@nodus/contracts';

/**
 * Формат и разбор значений кастомных полей (#431): числа — русская деловая
 * запись (пробелы групп, запятая), деньги — сумма + код валюты, дата —
 * ДД.ММ.ГГГГ, продолжительность — «ч:мм». Грамматика проверки живёт в
 * контрактах; здесь — только представление и ввод.
 */

const NBSP = /[\u00a0\u202f\s]/g;

/** Число с фиксированной точностью и группировкой: 1234.5 → «1 234,50». */
export function formatNumber(value: number, precision: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
}

/** Ввод числа: пробелы-группы и запятая допустимы; null — не число/точность. */
export function parseNumber(text: string, precision: number): number | null {
  const normalized = text.replace(NBSP, '').replace(',', '.').trim();
  if (normalized === '' || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || Math.abs(value) > CUSTOM_FIELD_LIMITS.amount) return null;
  // Тот же предикат, что у сервера/схемы: редактор не пропускает значение,
  // которое API отвергнет 422 (иначе оптимистичная правка откатывается тостом
  // вместо подсказки под полем).
  if (!hasDecimalPrecision(value, precision)) return null;
  return value;
}

/** Деньги: «1 234,56 BYN»; код валюты неизвестен — только сумма. */
export function formatMoney(value: MoneyValue, currencyName: string | null): string {
  const amount = formatNumber(value.amount, 2);
  return currencyName ? `${amount} ${currencyName}` : amount;
}

/** Продолжительность, минуты → «ч:мм» (90 → «1:30», 45 → «0:45»). */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${hours}:${String(rest).padStart(2, '0')}`;
}

/** Разбор «ч:мм» (и «1:5», «2»): null — не формат или вне 1..100000 минут. */
export function parseDurationInput(text: string): number | null {
  const normalized = text.trim();
  if (normalized === '') return null;
  const match = /^(\d{1,5})(?::(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (minutes > 59) return null;
  const total = hours * 60 + minutes;
  if (total < 1 || total > CUSTOM_FIELD_LIMITS.duration) return null;
  return total;
}

/** Дата ISO (YYYY-MM-DD) → «ДД.ММ.ГГГГ» без сдвига часового пояса. */
export function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** Дата-время ISO → «ДД.ММ.ГГГГ ЧЧ:ММ» в локальном времени. */
export function formatIsoDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Локальная дата → ISO-день (значение поля типа «Дата»). */
export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ISO-день → Date в локальной полночи (для пикера). */
export function fromIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
