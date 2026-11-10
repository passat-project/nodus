import { describe, expect, it } from 'vitest';

import { csvCell } from './task-press-format.js';

describe('CSV аналитики сбора (#434)', () => {
  it('кавычки экранируются, разделитель — точка с запятой', () => {
    expect(csvCell('Иванов; "ОВ1"')).toBe('"Иванов; ""ОВ1"""');
  });

  it('формулы не исполняются: = + - @ TAB CR получают апостроф', () => {
    expect(csvCell('=HYPERLINK("https://evil.example")')).toBe(
      '"\'=HYPERLINK(""https://evil.example"")"',
    );
    expect(csvCell('+1+1')).toBe('"\'+1+1"');
    expect(csvCell('-2+3')).toBe('"\'-2+3"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('\tcmd')).toBe('"\'\tcmd"');
    expect(csvCell('\rcmd')).toBe('"\'\rcmd"');
  });

  it('обычный текст и числа не трогаются', () => {
    expect(csvCell('Раздел ОВ1 согласован')).toBe('"Раздел ОВ1 согласован"');
    expect(csvCell('42')).toBe('"42"');
  });
});
