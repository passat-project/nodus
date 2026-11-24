import { describe, expect, it } from 'vitest';

import { MAX_FILE_NAME_LENGTH, safeFileName } from './safe-file-name.js';

/**
 * #1005, security-ревью: имя из multipart не должно раздувать заголовок
 * Content-Disposition (encodeURIComponent ~3×) до нечитаемого клиентами.
 */
describe('safeFileName — имя для хранения и Content-Disposition', () => {
  it('короткое имя не меняется, управляющие символы вырезаются', () => {
    expect(safeFileName('смета.pdf')).toBe('смета.pdf');
    expect(safeFileName('акт\u0001\n.pdf')).toBe('акт.pdf');
    expect(safeFileName('  отчёт.xlsx  ')).toBe('отчёт.xlsx');
  });

  it('длинное имя обрезается с сохранением расширения', () => {
    const long = `${'a'.repeat(480)}.webm`;
    const result = safeFileName(long);
    expect(result.length).toBe(MAX_FILE_NAME_LENGTH);
    expect(result.endsWith('.webm')).toBe(true);
  });

  it('длинное имя без расширения — ровный потолок', () => {
    const result = safeFileName('б'.repeat(500));
    expect(result.length).toBe(MAX_FILE_NAME_LENGTH);
  });

  it('длина на границе не трогается', () => {
    const name = `${'x'.repeat(MAX_FILE_NAME_LENGTH - 4)}.pdf`;
    expect(safeFileName(name)).toBe(name);
  });
});
