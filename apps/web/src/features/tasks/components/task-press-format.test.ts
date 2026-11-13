// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { PressRoundView } from '@nodus/contracts';

import {
  csvCell,
  downloadPressCsv,
  pressStateClass,
  pressStateLabel,
} from './task-press-format.js';

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

  it('подписи и классы всех состояний отметки', () => {
    const state = (value: 'pressed' | 'waiting' | 'returned' | 'excluded' | 'withdrawn') =>
      ({ state: value }) as never;
    expect(pressStateLabel(state('pressed'))).toBe('Сдано');
    expect(pressStateLabel(state('waiting'))).toBe('Ждём');
    expect(pressStateLabel(state('returned'))).toBe('Возвращено');
    expect(pressStateLabel(state('excluded'))).toBe('Снято');
    expect(pressStateLabel(state('withdrawn'))).toBe('Отозвано');
    expect(pressStateClass(state('pressed'))).toContain('success');
    expect(pressStateClass(state('returned'))).toContain('warning');
    expect(pressStateClass(state('waiting'))).toContain('accent');
    expect(pressStateClass(state('excluded'))).toContain('muted');
  });

  it('CSV-файл: заголовки, строки, имя с циклом и клик по ссылке', () => {
    const create = vi.fn((blob: Blob) => {
      void blob;
      return 'blob:test';
    });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => void 0);
    const round = {
      cycle: 3,
      entries: [
        {
          userId: 'u1',
          displayName: 'Иванов',
          order: 0,
          state: 'pressed',
          pressedAt: '2026-11-10T10:00:00.000Z',
          result: {
            text: '=SUM(A1)',
            messageIds: [],
            fileCount: 0,
            minutes: null,
            date: null,
          },
          returnReason: null,
        },
        {
          userId: 'u2',
          displayName: 'Петров',
          order: 1,
          state: 'returned',
          pressedAt: null,
          result: null,
          returnReason: 'Доработать',
        },
      ],
    } as unknown as PressRoundView;
    downloadPressCsv(round);
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:test');
    const blob = create.mock.calls[0]?.[0];
    expect(blob?.type).toContain('text/csv');
    click.mockRestore();
  });
});
