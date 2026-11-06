import { describe, expect, it } from 'vitest';

import {
  firstNameOf,
  formatDateTimeCompact,
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
