// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataTable, type DataTableField } from './data-table.js';

/**
 * A6-4 (#632): таблица-канон всех журналов — ОДНА компонента, и любой её
 * рендер (выбор строки, ховер, подвод курсора к краю) перерисовывал все
 * строки. На журнале в сотни писем/задач это дорого. Строка вынесена и
 * мемоизирована: счётчик рендеров ячейки — прямая мера.
 */

interface Row {
  id: string;
  title: string;
}

const ROWS: Row[] = [
  { id: 'a', title: 'Первая' },
  { id: 'b', title: 'Вторая' },
  { id: 'c', title: 'Третья' },
];

/** Счётчик рендеров строки: `render` ячейки зовётся ровно один раз на
 *  фактический рендер строки. */
function countingDefs(counts: Map<string, number>): DataTableField<Row>[] {
  return [
    {
      id: 'title',
      label: 'Название',
      defaultVisible: true,
      render: (row) => {
        counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
        return row.title;
      },
    },
  ];
}

/** Стабильные пропсы потребителя: новый колбэк на каждый рендер ломал бы
 *  memo честно (как и в реальном потребителе с useCallback). */
const openRow = () => {};
const rowKey = (row: Row) => row.id;

function table(defs: DataTableField<Row>[], rows: Row[] = ROWS) {
  return (
    <DataTable viewKey="test.rows" defs={defs} rows={rows} rowKey={rowKey} onOpenRow={openRow} />
  );
}

/** Чекбоксы: [0] — «выбрать все» в шапке, далее по строкам. */
const rowCheckbox = (index: number) => screen.getAllByRole('checkbox')[index + 1]!;

beforeEach(() => {
  // Таблица листает широкие списки ResizeObserver-ом — jsdom его не даёт.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DataTable: мемоизация строк (A6-4)', () => {
  it('выбор строки перерисовывает только её', () => {
    const counts = new Map<string, number>();
    const defs = countingDefs(counts);
    render(table(defs));
    expect(counts.size).toBe(3);
    const before = new Map(counts);

    fireEvent.click(rowCheckbox(0));

    expect(counts.get('a')).toBe((before.get('a') ?? 0) + 1);
    expect(counts.get('b')).toBe(before.get('b'));
    expect(counts.get('c')).toBe(before.get('c'));
    // Выбор применён (чекбокс отмечен) — поведение не изменилось.
    expect(rowCheckbox(0).getAttribute('aria-checked')).toBe('true');
  });

  it('повторный рендер таблицы с теми же данными строки не трогает', () => {
    const counts = new Map<string, number>();
    const defs = countingDefs(counts);
    const { rerender } = render(table(defs));
    // Первый рендер мог случиться до гидратации пресета вида — дальше
    // считаем от устойчивого состояния.
    rerender(table(defs));
    const before = new Map(counts);

    rerender(table(defs));

    expect(counts).toEqual(before);
  });

  it('смена данных строки перерисовывает именно её', () => {
    const counts = new Map<string, number>();
    const defs = countingDefs(counts);
    const { rerender } = render(table(defs));
    rerender(table(defs));
    const before = new Map(counts);

    const patched = ROWS.map((row) =>
      row.id === 'b' ? { ...row, title: 'Вторая (правка)' } : row,
    );
    rerender(table(defs, patched));

    expect(counts.get('b')).toBe((before.get('b') ?? 0) + 1);
    expect(counts.get('a')).toBe(before.get('a'));
    expect(counts.get('c')).toBe(before.get('c'));
    expect(screen.getByText('Вторая (правка)')).toBeTruthy();
  });
});
