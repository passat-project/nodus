// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useViewFields } from './use-view-fields.js';
import { useViewStore } from './view-store.js';

/**
 * #937: хук отдаёт `widthSet` — id колонок, которым ширину задал человек
 * (в пресете вида есть width). Авто-раскладка такие ширины не трогает.
 */

const DEFS = [
  { id: 'subject', label: 'Тема', defaultVisible: true, defaultWidth: 300 },
  { id: 'date', label: 'Дата', defaultVisible: false, defaultWidth: 120 },
];

beforeEach(() => {
  useViewStore.setState({
    views: { 'test.widths': { subject: { visible: true, width: 500 } } },
    sorts: {},
  });
});

describe('useViewFields: widthSet', () => {
  it('отдаёт только колонки с заданной человеком шириной', () => {
    const { result } = renderHook(() => useViewFields('test.widths', DEFS));

    expect([...result.current.widthSet]).toEqual(['subject']);
    expect(result.current.widthSet.has('date')).toBe(false);
  });

  it('скрытая колонка без ширины в набор не попадает', () => {
    const { result } = renderHook(() => useViewFields('test.widths', DEFS));

    expect(result.current.visibleFields.map((f) => f.id)).toEqual(['subject']);
    expect(result.current.visibleFields[0]?.width).toBe(500);
  });
});
