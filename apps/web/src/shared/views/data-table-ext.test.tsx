// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataTable, type DataTableField } from './data-table.js';

/**
 * #435: расширение канонической таблицы — группы (заголовок со счётчиком и
 * итогами, сворачивание), строка итогов и серверная сортировка (клик по
 * заголовку уходит наружу, клиентская не применяется).
 */

interface Row {
  id: string;
  title: string;
  group: string | null;
}

const ROWS: Row[] = [
  { id: 'a', title: 'Первая', group: 'Сметный' },
  { id: 'b', title: 'Вторая', group: 'Сметный' },
  { id: 'c', title: 'Третья', group: null },
];

const defs: DataTableField<Row>[] = [
  {
    id: 'title',
    label: 'Название',
    defaultVisible: true,
    locked: true,
    render: (row) => row.title,
    sortValue: (row) => row.title,
  },
];

const openRow = () => {};
const rowKey = (row: Row) => row.id;

function extTable(extOverrides: Record<string, unknown> = {}) {
  return (
    <DataTable
      viewKey="test.groups"
      selectable={false}
      defs={defs}
      rows={ROWS}
      rowKey={rowKey}
      onOpenRow={openRow}
      ext={{
        groups: {
          buckets: [
            { key: 'Сметный', count: 2, totals: [{ fn: 'sum', value: 240 }] },
            { key: null, count: 1, totals: [{ fn: 'sum', value: 60 }] },
          ],
          keyOf: (row) => row.group,
          labelOf: (key) => (key === null ? 'Без значения' : String(key)),
        },
        totals: { values: [{ fn: 'sum', value: 300 }], defs: [{ fn: 'sum', field: 'number' }] },
        ...extOverrides,
      }}
    />
  );
}

beforeEach(() => {
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

describe('DataTable ext: группы и итоги (#435)', () => {
  it('заголовки групп со счётчиком, null — «без значения»', () => {
    render(extTable());
    expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('Сметный'))).toBe(
      true,
    );
    expect(screen.getByText('2')).not.toBeNull();
    expect(screen.getByText('Без значения')).not.toBeNull();
  });

  it('сворачивание группы прячет её строки', () => {
    render(extTable());
    expect(screen.getByText('Первая')).not.toBeNull();
    fireEvent.click(screen.getByText('Сметный'));
    expect(screen.queryByText('Первая')).toBeNull();
    // Строки «без значения» остаются
    expect(screen.getByText('Третья')).not.toBeNull();
  });

  it('строка итогов показывает суммы сервера', () => {
    render(extTable());
    const totalsRow = screen.getByText('Итог').closest('[role="row"]');
    expect(totalsRow?.textContent).toContain('300');
  });
});

describe('DataTable ext: серверная сортировка (#435)', () => {
  it('клик по заголовку уходит в onServerSortCycle, порядок строк не меняется', () => {
    const onCycle = vi.fn();
    const { container } = render(
      <DataTable
        viewKey="test.serversort"
        selectable={false}
        defs={defs}
        rows={ROWS}
        rowKey={rowKey}
        onOpenRow={openRow}
        ext={{
          serverSort: { field: 'title', dir: 'asc' },
          onServerSortCycle: onCycle,
          isServerSortable: (field) => field.id === 'title',
        }}
      />,
    );
    const header = screen.getByText('Название');
    // Сортировка хедера — pointerdown/up (клик без движения, data-table-header).
    fireEvent.pointerDown(header);
    fireEvent.pointerUp(window);
    expect(onCycle).toHaveBeenCalledWith('title');
    // Клиентская пересортировка не применяется: порядок входа сохранён.
    const cells = [...container.querySelectorAll('[data-cell-field="title"]')];
    expect(cells.map((cell) => cell.textContent)).toEqual(['Первая', 'Вторая', 'Третья']);
  });

  it('несортируемая сервером колонка не кликается (без onServerSortCycle)', () => {
    const onCycle = vi.fn();
    render(
      <DataTable
        viewKey="test.serversort2"
        selectable={false}
        defs={defs}
        rows={ROWS}
        rowKey={rowKey}
        onOpenRow={openRow}
        ext={{
          serverSort: null,
          onServerSortCycle: onCycle,
          isServerSortable: () => false,
        }}
      />,
    );
    const header = screen.getByText('Название').closest('[role="columnheader"]');
    expect(header).not.toBeNull();
    fireEvent.pointerDown(header!);
    fireEvent.pointerUp(window);
    expect(onCycle).not.toHaveBeenCalled();
  });
});
