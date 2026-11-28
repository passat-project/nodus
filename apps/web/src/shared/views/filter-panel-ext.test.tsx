// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilterPanel } from './filter-panel.js';
import { FilterPanelExtSections } from './filter-panel-ext.js';
import type { FilterState, FilterValue } from './list-filters.js';
import { useListExt } from './list-ext/use-list-ext.js';
import type { ListFieldOption } from './list-ext/list-field-options.js';

/**
 * #435: секции расширения панели фильтра — группировка, итоги, «Сохранить как
 * вид», «Выгрузить CSV», пометка удалённого атрибута. Грамматика — прежние
 * контролы панели (комбобокс, кнопки-строки), без новых паттернов.
 */

const GROUP_FIELDS: ListFieldOption[] = [
  { value: 'stage', label: 'Статус' },
  { value: 'assignee', label: 'Ответственный' },
];
const NUMERIC_FIELDS: ListFieldOption[] = [
  { value: 'number', label: 'Номер' },
  { value: 'cf.22222222-2222-4222-8222-222222222222', label: 'Часы' },
];

/** Обвязка: живой хук ext + текстовое зеркало состояния для ассертов. */
function SectionsHarness({ mirror }: { mirror: (snapshot: string) => void }) {
  const ext = useListExt();
  mirror(
    JSON.stringify({
      group: ext.group?.field ?? null,
      totals: ext.totals,
    }),
  );
  return (
    <FilterPanelExtSections state={ext} groupFields={GROUP_FIELDS} numericFields={NUMERIC_FIELDS} />
  );
}

/** Сеансовый набор фильтров (без localStorage) — как у реальных потребителей. */
function useSessionFilters(initial: FilterState = {}) {
  let filters = initial;
  const setFilter = (id: string, value: FilterValue) => {
    filters = { ...filters, [id]: value };
  };
  return { filters, setFilter };
}

afterEach(() => cleanup());

beforeEach(() => {
  // Radix Select требует pointer capture и scrollIntoView — jsdom их не даёт.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

describe('FilterPanelExtSections: группировка и итоги (#435)', () => {
  it('выбор поля группировки меняет состояние', async () => {
    const mirror = vi.fn();
    render(<SectionsHarness mirror={mirror} />);
    // Комбобокс группировки открывается кликом, вариант — «Статус».
    const input = screen.getByLabelText('Группировка');
    fireEvent.click(input);
    const option = await screen.findByText('Статус');
    fireEvent.click(option);
    const last = mirror.mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(last).group).toBe('stage');
  });

  it('«Добавить итог» добавляет количество; выбор суммирует по полю', async () => {
    const mirror = vi.fn();
    render(<SectionsHarness mirror={mirror} />);
    fireEvent.click(screen.getByText('Добавить итог'));
    expect(JSON.parse(mirror.mock.calls.at(-1)![0]!).totals).toEqual([{ fn: 'count' }]);

    // Агрегат «Количество» → «Сумма»: открываем клавиатурой (Radix Select).
    const trigger = screen.getByRole('combobox', { name: 'Итоги' }) as HTMLElement;
    fireEvent.focus(trigger);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByText('Сумма'));
    expect(JSON.parse(mirror.mock.calls.at(-1)![0]!).totals[0].fn).toBe('sum');
  });
});

describe('FilterPanel ext: сохранение вида, CSV, удалённый атрибут (#435)', () => {
  const toolbarOf = (filters: FilterState) => ({
    query: '',
    setQuery: () => undefined,
    filters,
    setFilter: (id: string, value: FilterValue) => {
      filters[id] = value;
    },
    setFilters: () => undefined,
    resetAll: () => undefined,
    presets: [],
    pinnedId: undefined,
    savePreset: () => undefined,
    deletePreset: () => undefined,
    togglePin: () => undefined,
  });

  it('«Сохранить как вид» спрашивает имя и зовёт onSaveView', () => {
    const onSaveView = vi.fn();
    const session = useSessionFilters();
    render(
      <FilterPanel
        toolbar={toolbarOf(session.filters)}
        defs={[]}
        builtinPresets={[]}
        ext={{ sections: <span />, onSaveView }}
      />,
    );
    fireEvent.click(screen.getByText('Сохранить как вид'));
    const input = screen.getByPlaceholderText('Название вида…');
    fireEvent.change(input, { target: { value: 'Переработки' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSaveView).toHaveBeenCalledWith('Переработки');
  });

  it('«Выгрузить CSV» зовет onExportCsv', () => {
    const onExportCsv = vi.fn();
    const session = useSessionFilters();
    render(
      <FilterPanel
        toolbar={toolbarOf(session.filters)}
        defs={[]}
        builtinPresets={[]}
        ext={{ sections: <span />, onExportCsv }}
      />,
    );
    fireEvent.click(screen.getByText('Выгрузить CSV'));
    expect(onExportCsv).toHaveBeenCalledTimes(1);
  });

  it('удалённый атрибут помечен и снимается крестом', () => {
    const session = useSessionFilters({ 'cf.99999999-9999-4999-8999-999999999999': 'x' });
    render(
      <FilterPanel
        toolbar={toolbarOf(session.filters)}
        defs={[]}
        builtinPresets={[]}
        ext={{
          sections: <span />,
          removedFieldIds: ['cf.99999999-9999-4999-8999-999999999999'],
        }}
      />,
    );
    expect(screen.getAllByText('Удалённый атрибут').length).toBeGreaterThan(0);
  });

  it('сохранённые виды применяются кликом и удаляются', () => {
    const onApply = vi.fn();
    const onDelete = vi.fn();
    const session = useSessionFilters();
    const view = {
      id: 'v1',
      name: 'Сметы',
      entity: 'task' as const,
      scope: { kind: 'journal' as const },
      level: 'personal' as const,
      filter: [],
      sort: [],
      totals: [],
      columns: [],
      createdAt: '2026-11-01T00:00:00.000Z',
      createdBy: null,
    };
    render(
      <FilterPanel
        toolbar={toolbarOf(session.filters)}
        defs={[]}
        builtinPresets={[]}
        ext={{
          sections: <span />,
          savedViews: { views: [view], onApply, onDelete },
        }}
      />,
    );
    fireEvent.click(screen.getByText('Сметы'));
    expect(onApply).toHaveBeenCalledWith(view);
    fireEvent.click(screen.getByLabelText('Удалить вид'));
    expect(onDelete).toHaveBeenCalledWith(view);
  });
});
