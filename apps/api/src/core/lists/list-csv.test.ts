import { describe, expect, it } from 'vitest';

import { buildCsv, csvCell } from './list-csv.js';

describe('CSV списков (#435)', () => {
  it('русский Excel: BOM, «;», CRLF, кавычки по RFC 4180', () => {
    const csv = buildCsv(
      ['Название', 'Часы'],
      [
        ['Простой', 8],
        ['Точка с запятой; и "кавычки"', null],
        ['перевод\nстроки', 1.5],
      ],
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Название;Часы\r\n');
    // пустая ячейка после «;» — кавычки закрывают значение, потом разделитель
    expect(csv).toContain('"Точка с запятой; и ""кавычки""";\r\n');
    expect(csv).toContain('"перевод\nстроки";1.5\r\n');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('ячейка: null — пусто, число — как есть, без спецсимволов — без кавычек', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell('просто')).toBe('просто');
    expect(csvCell('a;b')).toBe('"a;b"');
  });
});
