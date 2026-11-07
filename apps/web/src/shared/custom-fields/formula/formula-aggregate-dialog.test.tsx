// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  CustomFieldDefinition,
  FormulaAggregate,
  FormulaNode,
  NodeKind,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormulaAggregateDialog } from './formula-aggregate-dialog.js';

/** Диалог агрегата (#632, §4c): функция, выборка, атрибут, условие;
 *  «все/хотя бы одна» требуют условия, «сколько» — без атрибута; кнопка
 *  не «Сохранить», а «Вставить в формулу». */

const STAMP = '2026-11-01T00:00:00.000Z';

function definition(id: string, number: number, name: string): CustomFieldDefinition {
  return {
    id,
    number,
    type: 'number',
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
    sortOrder: number,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

const KIND_BUILDING = '44000000-0000-4000-8000-0000000000b1';
const KINDS: NodeKind[] = [
  {
    id: KIND_BUILDING,
    name: 'Здание по генплану',
    icon: 'layers',
    color: 'amber',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
  },
];

const DEFINITIONS = [
  definition('a0000000-0000-4000-8000-000000000001', 28, 'Номер комплекта'),
  definition('a0000000-0000-4000-8000-000000000002', 29, 'Часы'),
];

function mount(initial: FormulaAggregate | null, hostKind: 'task' | 'node' = 'task') {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <FormulaAggregateDialog
      open
      initial={initial}
      hostKind={hostKind}
      definitions={DEFINITIONS}
      kinds={KINDS}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  return { onApply, onClose };
}

const applyButton = () =>
  screen.getByRole('button', { name: ui.formulas.aggregateDialog.apply }) as HTMLButtonElement;

afterEach(cleanup);

describe('FormulaAggregateDialog (#632, §4c)', () => {
  it('заголовок, селекты функции и выборки; СУММА без атрибута не вставляется', () => {
    mount(null);
    expect(screen.getByText(ui.formulas.aggregateDialog.title)).toBeTruthy();
    // Дефолт СУММА требует атрибут: функция, выборка и атрибут — три
    // селекта (у «СКОЛЬКО» селекта атрибута не будет).
    expect(screen.getAllByRole('combobox').length).toBe(3);
    expect(applyButton().disabled).toBe(true);
  });

  it('готовый агрегат: «Вставить в формулу» отдаёт его как есть', () => {
    const initial: FormulaAggregate = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'sum',
      field: 28,
    };
    const { onApply, onClose } = mount(initial);

    expect(applyButton().disabled).toBe(false);
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith(initial);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('СКОЛЬКО без атрибута и условия вставляется сразу', () => {
    const initial: FormulaAggregate = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'count',
    };
    const { onApply } = mount(initial);

    // «Сколько» не нуждается в атрибуте — селекта атрибута нет.
    expect(screen.getAllByRole('combobox').length).toBe(2);
    expect(applyButton().disabled).toBe(false);
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith({
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'count',
    });
  });

  it('ВСЕ без условия не вставляется: галочка условия обязательна', () => {
    const { onApply } = mount({
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'every',
    });
    expect(applyButton().disabled).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('цепочка папок: селект вида показывает реальный вид, а не пустоту', () => {
    const { onApply } = mount({
      kind: 'aggregate',
      from: { kind: 'folder_chain', kindId: KIND_BUILDING },
      fn: 'sum',
      field: 28,
    });
    // fn + from + вид папки + атрибут = четыре селекта.
    expect(screen.getAllByRole('combobox').length).toBe(4);
    expect(applyButton().disabled).toBe(false);
    fireEvent.click(applyButton());
    expect(onApply.mock.calls[0]![0].from).toEqual({ kind: 'folder_chain', kindId: KIND_BUILDING });
  });

  it('выборка «связанные»: селекты вида связи и направления на месте', () => {
    const { onApply } = mount({
      kind: 'aggregate',
      from: {
        kind: 'related',
        selector: { kind: 'relations', relation: 'blocks', direction: 'out' },
      },
      fn: 'sum',
      field: 28,
    });
    // fn + from + вид связи + направление + атрибут = пять селектов.
    expect(screen.getAllByRole('combobox').length).toBe(5);
    expect(applyButton().disabled).toBe(false);
    fireEvent.click(applyButton());
    expect(onApply.mock.calls[0]![0].from).toEqual({
      kind: 'related',
      selector: { kind: 'relations', relation: 'blocks', direction: 'out' },
    });
  });

  it('простое условие: атрибут, оператор и значение редактируются, уходят в агрегат', () => {
    const initial: FormulaAggregate = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'sum',
      field: 28,
      filter: {
        kind: 'op',
        op: 'ge',
        args: [
          { kind: 'field', source: { kind: 'self' }, number: 29 },
          { kind: 'literal', value: '5' },
        ],
      },
    };
    const { onApply } = mount(initial);

    // Условие включено: селекты атрибута условия и оператора + поле значения.
    expect(screen.getAllByRole('combobox').length).toBe(5);
    expect(screen.getByPlaceholderText(ui.formulas.aggregateDialog.value)).toBeTruthy();
    expect(screen.getByLabelText(ui.formulas.aggregateDialog.filterToggle)).toBeTruthy();
    expect(applyButton().disabled).toBe(false);

    fireEvent.click(applyButton());
    // Литерал условия нормализуется: числовой текст уходит числом.
    expect(onApply).toHaveBeenCalledWith({
      ...initial,
      filter: {
        kind: 'op',
        op: 'ge',
        args: [
          { kind: 'field', source: { kind: 'self' }, number: 29 },
          { kind: 'literal', value: 5 },
        ],
      },
    });
  });

  it('условие сложной формы: диалог честно говорит, что сохранит его как есть', () => {
    const complex: FormulaNode = {
      kind: 'op',
      op: 'eq',
      args: [
        { kind: 'system', entity: 'task', key: 'title', source: { kind: 'self' } },
        { kind: 'literal', value: 'x' },
      ],
    };
    const initial: FormulaAggregate = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'some',
      filter: complex,
    };
    const { onApply } = mount(initial);

    expect(screen.getByText(ui.formulas.aggregateDialog.filterComplex)).toBeTruthy();
    expect(applyButton().disabled).toBe(false);
    fireEvent.click(applyButton());
    // Сложное условие ушло в формулу без потерь.
    expect(onApply.mock.calls[0]![0].filter).toBe(complex);
  });

  it('«Отмена» закрывает диалог без вставки', () => {
    const { onApply, onClose } = mount(null);
    fireEvent.click(screen.getByRole('button', { name: ui.formulas.editor.cancel }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('закрытый диалог не рендерит ничего', () => {
    const { container } = render(
      <FormulaAggregateDialog
        open={false}
        initial={null}
        hostKind="task"
        definitions={DEFINITIONS}
        kinds={KINDS}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
