import { describe, expect, it } from 'vitest';

import {
  firstNameOf,
  formatDateTimeCompact,
  formatListTimestamp,
  shortPersonName,
  withoutPatronymic,
} from './format.js';

/** Форматирование имён (#132): приветствие ПО ИМЕНИ из «Фамилия Имя
 *  [Отчество]» (баг «Добрый день, Климович»); короткая форма для чата. */
describe('firstNameOf', () => {
  it('берёт ИМЯ из «Фамилия Имя Отчество»', () => {
    expect(firstNameOf('Климович Александр Петрович')).toBe('Александр');
    expect(firstNameOf('Климович Александр')).toBe('Александр');
  });
  it('один токен — как есть; пустое — пусто', () => {
    expect(firstNameOf('Администратор')).toBe('Администратор');
    expect(firstNameOf('')).toBe('');
    expect(firstNameOf(null)).toBe('');
    expect(firstNameOf(undefined)).toBe('');
  });
  it('лишние пробелы не мешают', () => {
    expect(firstNameOf('  Климович   Александр  ')).toBe('Александр');
  });
});

describe('shortPersonName', () => {
  it('«Имя Фамилия» без отчества; короткие не трогает', () => {
    expect(shortPersonName('Климович Александр Петрович')).toBe('Александр Климович');
    expect(shortPersonName('Администратор Системный')).toBe('Администратор Системный');
  });
});

describe('formatDateTimeCompact (превью ссылки на задачу)', () => {
  it('день.месяц + время без года', () => {
    expect(formatDateTimeCompact(new Date(2026, 10, 12, 14, 5).toISOString())).toBe('12.11, 14:05');
  });
});

describe('formatListTimestamp — метка списков бесед и уведомлений (#782, модель Битрикс24)', () => {
  // Понедельник 14.09.2026, 12:00 — ЛОКАЛЬНОЕ время: границы дня локальные.
  const now = new Date(2026, 8, 14, 12, 0);
  const at = (y: number, m: number, d: number, h = 10, min = 0) =>
    new Date(y, m - 1, d, h, min).toISOString();

  it('сегодня — время, ночное сообщение (00:05) — тоже «сегодня»', () => {
    expect(formatListTimestamp(at(2026, 9, 14, 14, 25), now)).toBe('14:25');
    expect(formatListTimestamp(at(2026, 9, 14, 0, 5), now)).toBe('00:05');
  });

  it('вчера — строка i18n', () => {
    expect(formatListTimestamp(at(2026, 9, 13, 22), now)).toBe('Вчера');
  });

  it('2–6 дней назад — день недели словом с заглавной буквы (скользящее окно)', () => {
    expect(formatListTimestamp(at(2026, 9, 12), now)).toBe('Суббота');
    expect(formatListTimestamp(at(2026, 9, 8), now)).toBe('Вторник');
  });

  it('7+ дней этого года — ДД.ММ, прошлый год — ДД.ММ.ГГГГ', () => {
    expect(formatListTimestamp(at(2026, 9, 7), now)).toBe('07.09');
    expect(formatListTimestamp(at(2025, 9, 3), now)).toBe('03.09.2025');
  });

  it('граница месяца и полуночи — по локальному дню', () => {
    const firstOfOctober = new Date(2026, 9, 1, 9, 0);
    expect(formatListTimestamp(at(2026, 9, 30, 22), firstOfOctober)).toBe('Вчера');
    const midnight = new Date(2026, 8, 14, 0, 0);
    expect(formatListTimestamp(at(2026, 9, 13, 23, 59), midnight)).toBe('Вчера');
    expect(formatListTimestamp(at(2026, 9, 14, 0, 0), midnight)).toBe('00:00');
  });

  it('будущее время (часы разъехались) — время, не дата', () => {
    expect(formatListTimestamp(at(2026, 9, 20), now)).toBe('10:00');
  });
});

describe('withoutPatronymic (#132 р.5: снапшоты старых сообщений)', () => {
  it('третий токен отбрасывается, порядок сохраняется', () => {
    expect(withoutPatronymic('Климович Александр Петрович')).toBe('Климович Александр');
  });

  it('два токена и короче — не трогает', () => {
    expect(withoutPatronymic('Климович Александр')).toBe('Климович Александр');
    expect(withoutPatronymic('Администратор')).toBe('Администратор');
  });

  it('лишние пробелы схлопываются', () => {
    expect(withoutPatronymic('  Иванова   Полина   Сергеевна  ')).toBe('Иванова Полина');
  });
});
