import { describe, expect, it } from 'vitest';

import { fitColumnWidths, type FitColumn } from './fit-columns.js';

/**
 * #937: раскладка ширин журнала — колонка под текст, свободная ширина зоны
 * раздаётся колонкам без ручной ширины. Тесты держат правила, на которых
 * стоит UX: содержимое не обрезается, ручные ширины не сбиваются, пустой
 * полосы справа нет.
 */

const BREATHING = 24;

const column = (over: Partial<FitColumn> & Pick<FitColumn, 'id'>): FitColumn => ({
  locked: false,
  base: 120,
  content: 80,
  min: 48,
  max: 640,
  ...over,
});

const widths = (list: FitColumn[], available: number) =>
  fitColumnWidths(list, available, BREATHING);

describe('fitColumnWidths', () => {
  it('ширина колонки — содержимое плюс воздух', () => {
    const result = widths([column({ id: 'subject', content: 300 })], 0);
    expect(result).toEqual({ subject: 324 });
  });

  it('содержимое сверх maxWidth обрезается пределом поля', () => {
    const result = widths([column({ id: 'subject', content: 5000, max: 640 })], 2000);
    expect(result).toEqual({ subject: 640 });
  });

  it('пустая колонка не уже своего minWidth', () => {
    const result = widths([column({ id: 'files', content: 0, min: 88 })], 0);
    expect(result).toEqual({ files: 88 });
  });

  it('колонку с ручной шириной раскладка не меняет', () => {
    const result = widths(
      [column({ id: 'counterparty', locked: true, base: 400, content: 100 })],
      0,
    );
    expect(result).toEqual({ counterparty: 400 });
  });

  it('свободное место занимается: сумма ширин = ширине зоны', () => {
    const result = widths(
      [column({ id: 'a', content: 100 }), column({ id: 'b', content: 200 })],
      800,
    );
    const sum = Object.values(result).reduce((acc, w) => acc + w, 0);
    expect(sum).toBe(800);
    // Больше запаса до maxWidth — больше прибавка.
    expect(result.b!).toBeGreaterThan(result.a!);
  });

  it('переполнение не сжимает колонки ниже содержимого — уходит в скролл', () => {
    const result = widths(
      [column({ id: 'a', content: 300 }), column({ id: 'b', content: 400 })],
      400,
    );
    expect(result).toEqual({ a: 324, b: 424 });
  });

  it('неизмеренная зона (0/NaN) оставляет колонки по содержимому', () => {
    const list = [column({ id: 'a', content: 100 })];
    expect(widths(list, 0)).toEqual({ a: 124 });
    expect(widths(list, Number.NaN)).toEqual({ a: 124 });
  });

  it('ручная ширина получает свободное место только после «свободных» колонок', () => {
    const result = widths(
      [
        column({ id: 'auto', content: 100, max: 200 }),
        column({ id: 'manual', locked: true, base: 300, max: 500 }),
      ],
      700,
    );
    // «Свободная» упёрлась в свой предел, остаток ушёл ручной.
    expect(result.auto).toBe(200);
    expect(result.manual).toBe(500);
    expect(Object.values(result).reduce((acc, w) => acc + w, 0)).toBe(700);
  });

  it('все колонки на максимуме: остаток не раздувает их сверх предела', () => {
    const result = widths([column({ id: 'a', content: 100, max: 124 })], 2000);
    expect(result).toEqual({ a: 124 });
  });

  it('ручная ширина не выходит за minWidth..maxWidth поля', () => {
    const result = widths([column({ id: 'a', locked: true, base: 20, min: 48, max: 200 })], 0);
    expect(result).toEqual({ a: 48 });
  });
});
