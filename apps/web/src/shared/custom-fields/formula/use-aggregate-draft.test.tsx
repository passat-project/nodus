// @vitest-environment jsdom
import type {
  CustomFieldDefinition,
  FormulaAggregate,
  FormulaNode,
  NodeKind,
} from '@nodus/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAggregateDraft } from './use-aggregate-draft.js';

/** Черновик диалога агрегата (#632): выборка, функция, атрибут, условие.
 *  Инициализация — один раз на открытие; сложное условие сохраняется как
 *  есть, а не теряется. apply собирает агрегат по контракту. */

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

function nodeKind(id: string, name: string): NodeKind {
  return {
    id,
    name,
    icon: 'layers',
    color: 'amber',
    archivedAt: null,
    form: { fields: [] },
    capabilities: [],
  };
}

const KIND_BUILDING = '44000000-0000-4000-8000-0000000000b1';
const KINDS = [
  nodeKind(KIND_BUILDING, 'Здание по генплану'),
  nodeKind('44000000-0000-4000-8000-0000000000b2', 'Раздел'),
];
const DEFINITIONS = [
  definition('a0000000-0000-4000-8000-000000000001', 28, 'Номер комплекта'),
  definition('a0000000-0000-4000-8000-000000000002', 29, 'Часы'),
  {
    ...definition('a0000000-0000-4000-8000-000000000003', 30, 'Папочная'),
    isCompany: false,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [KIND_BUILDING] },
  },
];

function mount(initial: FormulaAggregate | null, hostKind: 'task' | 'node' | 'letter' = 'task') {
  const onApply = vi.fn();
  const hook = renderHook(
    ({ open, aggregate }: { open: boolean; aggregate: FormulaAggregate | null }) =>
      useAggregateDraft({
        open,
        initial: aggregate,
        hostKind,
        definitions: DEFINITIONS,
        kinds: KINDS,
        onApply,
      }),
    { initialProps: { open: true, aggregate: initial } },
  );
  return { onApply, ...hook };
}

afterEach(cleanup);

describe('useAggregateDraft: новый агрегат (#632)', () => {
  it('по умолчанию СУММА по подзадачам; без атрибута применить нельзя', () => {
    const { result } = mount(null);
    expect(result.current.fn).toBe('sum');
    expect(result.current.from).toBe('subtasks');
    expect(result.current.needsField).toBe(true); // sum требует атрибут
    expect(result.current.needsFilter).toBe(false);
    expect(result.current.canApply).toBe(false);
  });

  it('после выбора атрибута apply собирает агрегат по подзадачам', () => {
    const { result, onApply } = mount(null);
    act(() => result.current.setFieldNumber('28'));
    expect(result.current.canApply).toBe(true);

    act(() => result.current.apply());
    expect(onApply).toHaveBeenCalledWith({
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'sum',
      field: 28,
    });
  });

  it('СКОЛЬКО не требует ни атрибута, ни условия', () => {
    const { result, onApply } = mount(null);
    act(() => result.current.setFn('count'));
    expect(result.current.needsField).toBe(false);
    expect(result.current.canApply).toBe(true);

    act(() => result.current.apply());
    expect(onApply).toHaveBeenCalledWith({
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'count',
    });
  });

  it('ВСЕ требует условие: без него применить нельзя, «сколько» полей-условий нет', () => {
    const { result } = mount(null);
    act(() => result.current.setFn('every'));
    expect(result.current.needsFilter).toBe(true);
    expect(result.current.canApply).toBe(false);

    act(() => result.current.setFilterNumber('29'));
    expect(result.current.canApply).toBe(true);
  });
});

describe('useAggregateDraft: условие выборки (#632)', () => {
  it('число с запятой становится числовым литералом, текст — строкой', () => {
    const { result, onApply } = mount(null);
    act(() => {
      result.current.setFn('sum');
      result.current.setFieldNumber('28');
      result.current.setFilterEnabled(true);
      result.current.setFilterNumber('29');
      result.current.setFilterValue('3,5');
    });
    act(() => result.current.apply());

    const aggregate = onApply.mock.calls[0]![0] as FormulaAggregate;
    expect(aggregate.filter).toEqual({
      kind: 'op',
      op: 'eq',
      args: [
        { kind: 'field', source: { kind: 'self' }, number: 29 },
        { kind: 'literal', value: 3.5 },
      ],
    });
  });

  it('да/нет распознаются, оператор берётся из выбора', () => {
    const { result, onApply } = mount(null);
    act(() => {
      result.current.setFn('sum');
      result.current.setFieldNumber('28');
      result.current.setFilterEnabled(true);
      result.current.setFilterNumber('28');
      result.current.setFilterOperator('ge');
      result.current.setFilterValue('ИСТИНА');
    });
    act(() => result.current.apply());

    const aggregate = onApply.mock.calls[0]![0] as FormulaAggregate;
    expect(aggregate.filter).toMatchObject({ op: 'ge', args: [{ number: 28 }, { value: true }] });
  });

  it('выборка «связанные»: вид связи и направление уходят в селектор', () => {
    const { result, onApply } = mount(null);
    act(() => {
      result.current.setFn('sum');
      result.current.setFrom('relations');
      result.current.setRelation('blocks');
      result.current.setDirection('in');
      result.current.setFieldNumber('28');
    });
    act(() => result.current.apply());

    const aggregate = onApply.mock.calls[0]![0] as FormulaAggregate;
    expect(aggregate.from).toEqual({
      kind: 'related',
      selector: { kind: 'relations', relation: 'blocks', direction: 'in' },
    });
  });

  it('цепочка папок: вид по умолчанию — первый из списка, можно сменить', () => {
    const { result, onApply } = mount(null);
    act(() => {
      result.current.setFn('sum');
      result.current.setFrom('folder_chain');
      result.current.setFieldNumber('30');
    });
    expect(result.current.canApply).toBe(true);
    // Для цепочки доступны только атрибуты с привязкой к видам папок.
    expect(result.current.fieldDefinitions.map((entry) => entry.number)).toEqual([30]);

    act(() => result.current.apply());
    let aggregate = onApply.mock.calls[0]![0] as FormulaAggregate;
    expect(aggregate.from).toEqual({ kind: 'folder_chain', kindId: KIND_BUILDING });

    act(() => result.current.setFolderKindId('44000000-0000-4000-8000-0000000000b2'));
    act(() => result.current.apply());
    aggregate = onApply.mock.calls[1]![0] as FormulaAggregate;
    expect(aggregate.from).toEqual({
      kind: 'folder_chain',
      kindId: '44000000-0000-4000-8000-0000000000b2',
    });
  });
});

describe('useAggregateDraft: правка существующего и инициализация (#632)', () => {
  const comparison: FormulaNode = {
    kind: 'op',
    op: 'ne',
    args: [
      { kind: 'field', source: { kind: 'self' }, number: 29 },
      { kind: 'literal', value: 'срочно' },
    ],
  };

  it('существующий агрегат разворачивается в черновик: функция, выборка, поле, условие', () => {
    const initial: FormulaAggregate = {
      kind: 'aggregate',
      from: {
        kind: 'related',
        selector: { kind: 'relations', relation: 'duplicates', direction: 'out' },
      },
      fn: 'avg',
      field: 28,
      filter: comparison,
    };
    const { result } = mount(initial);

    expect(result.current.fn).toBe('avg');
    expect(result.current.from).toBe('relations');
    expect(result.current.relation).toBe('duplicates');
    expect(result.current.direction).toBe('out');
    expect(result.current.fieldNumber).toBe('28');
    expect(result.current.filterEnabled).toBe(true);
    expect(result.current.filterNumber).toBe('29');
    expect(result.current.filterOperator).toBe('ne');
    expect(result.current.filterValue).toBe('срочно');
    expect(result.current.complexFilter).toBeNull();
  });

  it('булев литерал условия показывается словами ИСТИНА/ЛОЖЬ', () => {
    const initial: FormulaAggregate = {
      kind: 'aggregate',
      from: { kind: 'related', selector: { kind: 'subtasks' } },
      fn: 'sum',
      field: 28,
      filter: {
        kind: 'op',
        op: 'eq',
        args: [
          { kind: 'field', source: { kind: 'self' }, number: 28 },
          { kind: 'literal', value: false },
        ],
      },
    };
    const { result } = mount(initial);
    expect(result.current.filterValue).toBe('ЛОЖЬ');
  });

  it('условие сложной формы не редактируется построчно — сохранится как есть', () => {
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
    const { result, onApply } = mount(initial);

    expect(result.current.complexFilter).toBe(complex);
    // some требует условие — сложное условие его закрывает.
    expect(result.current.needsFilter).toBe(true);
    expect(result.current.canApply).toBe(true);

    act(() => result.current.apply());
    const aggregate = onApply.mock.calls[0]![0] as FormulaAggregate;
    expect(aggregate.filter).toBe(complex);
  });

  it('переоткрытие с другим агрегатом переинициализирует черновик ровно один раз', () => {
    const first: FormulaAggregate = {
      kind: 'aggregate',
      from: { kind: 'folder_chain', kindId: KIND_BUILDING },
      fn: 'min',
      field: 30,
    };
    const { result, rerender } = mount(first);
    expect(result.current.from).toBe('folder_chain');
    expect(result.current.fn).toBe('min');

    // Закрыли — черновик сброшен под следующий opening.
    rerender({ open: false, aggregate: null });
    // Пока закрыт, пропсы меняются молча (поздний kinds не сбивает выбор).
    rerender({ open: false, aggregate: first });

    rerender({
      open: true,
      aggregate: {
        kind: 'aggregate',
        from: { kind: 'related', selector: { kind: 'node_tasks' } },
        fn: 'max',
        field: 29,
      },
    });
    expect(result.current.from).toBe('node_tasks');
    expect(result.current.fn).toBe('max');
    expect(result.current.fieldNumber).toBe('29');
  });
});

describe('useAggregateDraft: матрица носителя (#632)', () => {
  it('папке доступны задачи папки и цепочка, письму — никакие выборки', () => {
    const { result: nodeDraft } = mount(null, 'node');
    expect(nodeDraft.current.options).toEqual(['node_tasks', 'folder_chain']);
    // Дефолт для папки — не подзадачи, а первый доступный пункт.
    expect(nodeDraft.current.from).toBe('node_tasks');

    const { result: letterDraft } = mount(null, 'letter');
    expect(letterDraft.current.options).toEqual([]);
    expect(letterDraft.current.canApply).toBe(false);
  });
});
