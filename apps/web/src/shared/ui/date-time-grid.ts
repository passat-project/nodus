/** Чистая логика сетки календаря датапикера (`date-time-picker.tsx`) —
 *  без зависимостей (Intl только в компоненте): сетка 6 недель с понедельника
 *  и быстрые варианты крайнего срока (модель Битрикс24, вердикт владельца
 *  15.09.2026: нативный datetime-local «из 2000-х» не нужен). */

export interface DayCell {
  date: Date;
  inMonth: boolean;
}

/** 42 ячейки (6 недель) месяца, начало — понедельник недели 1-го числа. */
export function monthGridCells(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1);
  // Понедельник — начало недели: JS getDay (Вс=0..Сб=6) → сдвиг назад.
  const back = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - back);
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date, inMonth: date.getMonth() === month });
  }
  return cells;
}

export type QuickOptionId = 'today' | 'tomorrow' | 'endOfWeek' | 'inAWeek' | 'endOfMonth';

/** Дата быстрого варианта от `now` (время не трогаем — оно из поля времени). */
export function quickOptionDate(id: QuickOptionId, now: Date): Date {
  const at = (plusDays: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + plusDays);
  switch (id) {
    case 'today':
      return at(0);
    case 'tomorrow':
      return at(1);
    case 'endOfWeek': {
      // Ближайшая пятница (сегодня пятница — сегодня), модель Битрикс24.
      const delta = (5 - now.getDay() + 7) % 7;
      return at(delta);
    }
    case 'inAWeek':
      return at(7);
    case 'endOfMonth':
      return new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }
}

/** «HH:MM» строго 00:00–23:59; null — невалидный ввод. */
export function parseTime(value: string): { hours: number; minutes: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return { hours: Number(m[1]), minutes: Number(m[2]) };
}

/** «yyyy-mm-dd» из контрактов → локальная дата; null — пусто или мусор.
 *  Проверяет реальность дня (31.02 не превращается в 3 марта). */
export function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** Дата для подписи «только дата» — дд.мм.гггг (год обязателен для дней
 *  рождения: у крайнего срока он не нужен, у даты рождения — критичен). */
export function formatDateRu(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** Слоты времени «HH:MM» от 00:00 до 23:55 с шагом `stepMinutes` (TimePicker:
 *  фиксированный шаг — сетка не прыгает, точное значение вводится руками). */
export function timeSlots(stepMinutes = 15): string[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const slots: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    slots.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  }
  return slots;
}

/** Локальная дата в «yyyy-mm-dd» (для date-полей контрактов): DateTimePicker
 *  отдаёт Date с временем, а РКК/поручения хранят срок датой. */
export function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
