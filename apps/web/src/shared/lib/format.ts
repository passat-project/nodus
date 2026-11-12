import { ui } from '@nodus/contracts';

import { localDayDiff } from './local-day.js';

/** Размер файла человеком (чип вложения): «367 КБ», «2,4 МБ».
 *  Единицы — из i18n (I15); ЕДИНЫЙ порог КБ/МБ на весь продукт (аудит #45:
 *  локальный formatSize письма делил по 1000 — один файл показывал разный
 *  размер в чате и в письме). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${ui.common.sizeB}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} ${ui.common.sizeKb}`;
  return `${(kb / 1024).toFixed(1).replace('.', ',')} ${ui.common.sizeMb}`;
}

/** Часы:минуты для трудозатрат (I14): 95 → «1:35». */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Дата/время в русской деловой форме: «3 сентября, 17:00». */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Компактная дата/время для тесных карточек (превью ссылки): «12.11, 14:00». */
export function formatDateTimeCompact(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Метка времени в СПИСКАХ (беседы, уведомления; модель Битрикс24, вердикт
 *  владельца 11.11.2026): сегодня — «14:25», вчера — «Вчера», 2–6 дней
 *  назад — сокращённый день недели («Ср»), 7+ дней этого года — «03.09»,
 *  прошлые годы — «03.09.2025». «Последние 7 дней» — скользящее окно,
 *  границы дня — локальные (не UTC, #782); `now` инжектируется для
 *  детерминированных тестов. */
export function formatListTimestamp(iso: string, now: Date = new Date()): string {
  const diffDays = localDayDiff(iso, now);
  // Сегодня и «будущее» (расхождение часов пользователя и сервера) — время.
  if (diffDays <= 0) return formatTime(iso);
  if (diffDays === 1) return ui.common.dateYesterday;
  const day = new Date(iso);
  if (diffDays < 7) {
    // Сокращённые дни недели — из i18n (I15): «Пн», «Вт», … (getDay: 0 — Вс).
    return ui.common.weekdaysShort[(day.getDay() + 6) % 7] ?? '';
  }
  return day.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Компактная дата/время для таблиц (моно-колонки): «03.09.2026, 17:00». */
export function formatDateTimeShort(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Русская плюральная форма числа: plural(5, ['письмо','письма','писем']) → 'писем'.
 *  Формы передаются из i18n (I15), не хардкодом в компонентах. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const digit = abs % 10;
  if (abs > 10 && abs < 20) return forms[2] ?? '';
  if (digit > 1 && digit < 5) return forms[1] ?? '';
  if (digit === 1) return forms[0] ?? '';
  return forms[2] ?? '';
}

/** Короткое имя человека для компактных строк (просмотры чата, вердикт
 *  раунда 4: «имя фамилия, без отчества»). Полное имя в справочнике —
 * «Фамилия Имя Отчество»; здесь — «Имя Фамилия». Короткие формы (два токена
 *  и менее) не трогаем («Администратор Системный»). */
export function shortPersonName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length < 3) return displayName;
  return `${parts[1]} ${parts[0]}`;
}

/** Имя из «Фамилия Имя [Отчество]» — приветствия по имени (#132: раньше
 *  split(' ')[0] давал ФАМИЛИЮ — «Добрый день, Климович»). Единственный
 *  токен возвращается как есть. */
export function firstNameOf(displayName: string | null | undefined): string {
  if (!displayName) return '';
  const parts = displayName.trim().split(/\s+/);
  return parts[1] ?? parts[0] ?? '';
}

/** «Фамилия Имя Отчество» → «Фамилия Имя» (#132 р.5): отчества убраны из UI,
 *  но СТАРЫЕ снапшоты сообщений (UserRef.displayName вшит в реплаи,
 *  пересылки, просмотры, typing) не мигрируются — фронт чистит НАВСЕГДА.
 *  Правило простое: ≥3 токенов → третий отбрасывается; короткие формы
 *  («Имя Фамилия», «Администратор») не трогаем. */
export function withoutPatronymic(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length < 3) return displayName;
  return `${parts[0]} ${parts[1]}`;
}
