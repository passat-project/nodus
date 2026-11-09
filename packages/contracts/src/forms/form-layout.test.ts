import { describe, expect, it } from 'vitest';

import {
  checkFormDecor,
  countFormDecor,
  defaultFormHeight,
  FORM_DECOR_KINDS,
  formFieldWidth,
  formRows,
  hasPairedRow,
  isFormDecor,
} from './form-layout.js';

/** Раскладка окон (#496, Р1/Р2): строки из половин, оформление, высота. */

describe('раскладка окон: строки', () => {
  it('две половины делят строку, одиночная половина — своя строка', () => {
    const rows = formRows(['full', 'half-a', 'half-b', 'half-c'], (element) =>
      element.startsWith('half'),
    );
    expect(rows).toEqual([['full'], ['half-a', 'half-b'], ['half-c']]);
  });

  it('оформление перед половинами разрывает пару; пара определяется по ширине', () => {
    const elements = [{ kind: 'heading' }, { w: 'half' }, { w: 'half' }, { w: 'full' }];
    const isHalf = (element: { w?: string }) => element.w === 'half';
    expect(formRows(elements, isHalf)).toHaveLength(3);
    expect(hasPairedRow(elements, isHalf)).toBe(true);
    expect(hasPairedRow([{ w: 'full' }], isHalf)).toBe(false);
    expect(formRows([], isHalf)).toEqual([]);
  });

  it('высота: у длинного текста и описания — несколько строк, ширина — вся', () => {
    expect(defaultFormHeight('long_text')).toBe('lines');
    expect(defaultFormHeight('description')).toBe('lines');
    expect(defaultFormHeight('text')).toBe('line');
    expect(formFieldWidth(undefined)).toBe('full');
    expect(formFieldWidth({ width: 'half' })).toBe('half');
  });
});

describe('раскладка окон: оформление', () => {
  it('пустые заголовок и пояснение — проблема публикации; отступ допустим', () => {
    const elements = [
      { kind: 'heading', id: 'dhead001', text: '  ' },
      { kind: 'note', id: 'dnote001', text: 'Пояснение' },
      { kind: 'note', id: 'dnote002', text: '' },
      { kind: 'gap', id: 'dgap0001' },
      { fieldId: 'not-decor' },
    ];
    expect(checkFormDecor(elements)).toEqual(['dhead001', 'dnote002']);
    expect(countFormDecor(elements)).toBe(4);
    expect(FORM_DECOR_KINDS).toEqual(['heading', 'note', 'gap']);
  });

  it('isFormDecor различает оформление и поле', () => {
    expect(isFormDecor({ kind: 'gap', id: 'dgap0001' })).toBe(true);
    expect(isFormDecor({ kind: 'field', key: 'deadline' })).toBe(false);
    expect(isFormDecor(null)).toBe(false);
    expect(isFormDecor('heading')).toBe(false);
  });
});
