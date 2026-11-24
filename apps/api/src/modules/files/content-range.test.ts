import { describe, expect, it } from 'vitest';

import { decideContentRange } from './content-range.js';

/**
 * #1005: разбор `Range` — единственный диапазон, негодное игнорируем (200),
 * вне файла — 416, конец за размером обрезаем.
 */
describe('decideContentRange — Range заголовок контента файла', () => {
  it('без заголовка/пустой — весь файл', () => {
    expect(decideContentRange(undefined, 100)).toEqual({ kind: 'full' });
    expect(decideContentRange('', 100)).toEqual({ kind: 'full' });
  });

  it('другой unit или негодный синтаксис — весь файл (сервер вправе игнорировать)', () => {
    expect(decideContentRange('items=0-10', 100)).toEqual({ kind: 'full' });
    expect(decideContentRange('bytes=abc', 100)).toEqual({ kind: 'full' });
    expect(decideContentRange('bytes=0', 100)).toEqual({ kind: 'full' });
    expect(decideContentRange('bytes=-', 100)).toEqual({ kind: 'full' });
    expect(decideContentRange('bytes=1-2-3', 100)).toEqual({ kind: 'full' });
  });

  it('многодиапазонный запрос — весь файл (multipart браузеру не нужен)', () => {
    expect(decideContentRange('bytes=0-1,5-6', 100)).toEqual({ kind: 'full' });
  });

  it('start-end и start- — точный срез', () => {
    expect(decideContentRange('bytes=0-3', 100)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 3 },
    });
    expect(decideContentRange('bytes=10-', 100)).toEqual({
      kind: 'partial',
      range: { start: 10, end: 99 },
    });
    expect(decideContentRange('bytes=0-0', 100)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 0 },
    });
  });

  it('конец за размером файла обрезается до последнего байта', () => {
    expect(decideContentRange('bytes=90-9999', 100)).toEqual({
      kind: 'partial',
      range: { start: 90, end: 99 },
    });
  });

  it('suffix-диапазон: последние N байт; N больше файла — весь файл', () => {
    expect(decideContentRange('bytes=-10', 100)).toEqual({
      kind: 'partial',
      range: { start: 90, end: 99 },
    });
    expect(decideContentRange('bytes=-500', 100)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 99 },
    });
    expect(decideContentRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' });
  });

  it('вне файла/пустой диапазон — 416', () => {
    expect(decideContentRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(decideContentRange('bytes=9-5', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(decideContentRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('переполнение чисел не роняет разбор', () => {
    expect(decideContentRange('bytes=999999999999999999999999-', 100)).toEqual({ kind: 'full' });
  });

  it('регистр единицы и пробелы по краям допустимы', () => {
    expect(decideContentRange(' BYTES=0-1 ', 100)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 1 },
    });
  });
});
