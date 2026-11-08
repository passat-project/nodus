import { describe, expect, it } from 'vitest';

import {
  letterSeriesTemplate,
  numberCountOf,
  parseNumberTemplate,
  renderNumberTemplate,
} from './number-template.js';

/** 15.06.2026 12:00 UTC — Минск: 15.06.2026 (год 2026, месяц 06). */
const JUN_2026 = new Date('2026-06-15T12:00:00.000Z');
// 31.12.2026 23:30 UTC = 01.01.2027 02:30 по Минску.
const NEW_YEAR = new Date('2026-12-31T23:30:00.000Z');

describe('renderNumberTemplate (#630, Р2/Р3)', () => {
  it('письмо-шаблон бит-в-бит формату #55: «Вх-2026/118»', () => {
    expect(renderNumberTemplate(letterSeriesTemplate('Вх'), { seq: 118, at: JUN_2026 })).toBe(
      'Вх-2026/118',
    );
    expect(renderNumberTemplate(letterSeriesTemplate('Исх'), { seq: 3, at: JUN_2026 })).toBe(
      'Исх-2026/3',
    );
  });

  it('книга изменений «15-26»: старт 15, год двумя цифрами', () => {
    const template = [
      { kind: 'counter', minLength: 2 },
      { kind: 'literal', text: '-' },
      { kind: 'year', digits: 2 },
    ] as const;
    expect(renderNumberTemplate(template, { seq: 15, at: JUN_2026 })).toBe('15-26');
  });

  it('«Изм. 3» и добивка нулями «ОВ1-И-0007»', () => {
    expect(
      renderNumberTemplate([{ kind: 'literal', text: 'Изм. ' }, { kind: 'counter' }], {
        seq: 3,
        at: JUN_2026,
      }),
    ).toBe('Изм. 3');
    expect(
      renderNumberTemplate(
        [
          { kind: 'literal', text: 'ОВ1-И-' },
          { kind: 'counter', minLength: 4 },
        ],
        { seq: 7, at: JUN_2026 },
      ),
    ).toBe('ОВ1-И-0007');
  });

  it('месяц двумя цифрами; год 31.12→01.01 меняется по Минску', () => {
    expect(
      renderNumberTemplate(
        [{ kind: 'month' }, { kind: 'literal', text: '/' }, { kind: 'counter' }],
        {
          seq: 1,
          at: JUN_2026,
        },
      ),
    ).toBe('06/1');
    expect(renderNumberTemplate(letterSeriesTemplate('Вх'), { seq: 1, at: NEW_YEAR })).toBe(
      'Вх-2027/1',
    );
  });

  it('поле-сегмент: значение читателя; без читателя и пустое — пустая вставка', () => {
    const template = [
      { kind: 'field', fieldNumber: 12, source: 'self' },
      { kind: 'literal', text: '-' },
      { kind: 'counter' },
    ] as const;
    const read = () => 'И-1041';
    expect(renderNumberTemplate(template, { seq: 1, at: JUN_2026, field: read })).toBe('И-1041-1');
    expect(renderNumberTemplate(template, { seq: 1, at: JUN_2026 })).toBe('-1');
    expect(renderNumberTemplate(template, { seq: 1, at: JUN_2026, field: () => '' })).toBe('-1');
  });
});

describe('parseNumberTemplate', () => {
  it('валидный письмо-шаблон разбирается', () => {
    expect(parseNumberTemplate(letterSeriesTemplate('Вх')).ok).toBe(true);
  });

  it('без counter-сегмента, пустой и битый JSONB — отказ', () => {
    expect(parseNumberTemplate([{ kind: 'literal', text: 'Книга' }]).ok).toBe(false);
    expect(parseNumberTemplate([]).ok).toBe(false);
    expect(parseNumberTemplate({ no: 'array' }).ok).toBe(false);
    expect(parseNumberTemplate([{ kind: 'nope' }]).ok).toBe(false);
  });
});

describe('numberCountOf (#630)', () => {
  const key = (period: 'none' | 'year' | 'month', at: Date, container: string | null) =>
    numberCountOf(period, at, container).scopeKey;

  it('вся компания: год → «2026» (формат прода писем), месяц → «2026-06», никогда → common', () => {
    expect(key('year', JUN_2026, null)).toBe('2026');
    expect(key('month', JUN_2026, null)).toBe('2026-06');
    expect(key('none', JUN_2026, null)).toBe('common');
  });

  it('годовой переход 31.12→01.01: ключ меняется по Минску (К4)', () => {
    expect(key('year', NEW_YEAR, null)).toBe('2027');
    expect(numberCountOf('month', NEW_YEAR, null).periodKey).toBe('2027-01');
  });

  it('контейнер + период через «|»; без периода — только id контейнера', () => {
    const folder = '0b2b4f3e-9c1e-4d5f-8a1b-2c3d4e5f6071';
    expect(key('year', JUN_2026, folder)).toBe(`${folder}|2026`);
    expect(key('none', JUN_2026, folder)).toBe(folder);
    expect(numberCountOf('none', JUN_2026, folder).periodKey).toBe('');
  });
});
