import { describe, expect, it } from 'vitest';

import { fileExtension, isOfficeTextFormat, officeFormat } from './office-formats.js';

/** Матрица #182: текстовые табличные форматы обязаны проходить полный цикл
 * просмотра/правки — tsv однажды выпал из таблицы при живой BOM-логике
 * (isOfficeTextFormat знал, officeFormat — нет). */
describe('office-formats (#182 матрица)', () => {
  it('csv и tsv — редактируемые таблицы', () => {
    expect(officeFormat('данные.csv')).toEqual({ documentType: 'cell', editable: true });
    expect(officeFormat('план.tsv')).toEqual({ documentType: 'cell', editable: true });
  });

  it('текстовые форматы BOM-нормализации совпадают с редактируемыми', () => {
    for (const ext of ['txt', 'csv', 'tsv']) {
      const info = officeFormat(`файл.${ext}`);
      expect(info, ext).not.toBeNull();
      expect(isOfficeTextFormat(`файл.${ext}`), ext).toBe(true);
    }
  });

  it('неизвестное расширение и пустое — не офисные', () => {
    expect(officeFormat('archive.zip')).toBeNull();
    expect(officeFormat('безрасширения')).toBeNull();
    expect(fileExtension('a.BIG.PNG')).toBe('png');
  });

  it('прототип не считается форматом (#843): «constructor» и «toString» — не офисные', () => {
    expect(officeFormat('constructor')).toBeNull();
    expect(officeFormat('файл.toString')).toBeNull();
    expect(officeFormat('файл.__proto__')).toBeNull();
  });
});
