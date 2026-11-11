// @vitest-environment jsdom
import { DndContext } from '@dnd-kit/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, TaskListItem } from '@nodus/contracts';

import type { StructureField } from './structure-cells.js';
import type { StructureNodeRow, StructureTaskRow } from '../lib/structure-tree.js';
import { StructureNodeRowView, StructureTaskRowView } from './structure-rows.js';

/** Строки дерева структуры: атрибутные ячейки (#632) берут значение у СВОЕГО
 *  носителя — папка из node.customFields со ссылками среза структуры, задача
 *  из task.customFields со своими ссылками. Атрибут чужого носителя в строке
 *  не показывается (пустая ячейка, как любая неприменимая). */

const NOTE_ID = '55000000-0000-4000-8000-000000000001';
const TASK_FIELD_ID = '55000000-0000-4000-8000-000000000002';
const NODE_KIND = '44000000-0000-4000-8000-000000000001';
const TASK_TYPE = '31000000-0000-4000-8000-000000000001';
const REF_ID = '11000000-0000-4000-8000-000000000002';

const ZERO_ROLLUP = {
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
};

const USER = {
  id: '11000000-0000-4000-8000-000000000001',
  displayName: 'Клевантович А.',
  avatarUrl: null,
};

function definition(extra: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return {
    id: NOTE_ID,
    number: 1,
    type: 'text',
    name: 'Примечание',
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [NODE_KIND] },
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

const nodeAttribute = definition();
const taskAttribute = definition({
  id: TASK_FIELD_ID,
  name: 'Сотрудник-заказчик',
  type: 'user',
  bindings: { processTypeIds: [TASK_TYPE], projectTypeIds: [], nodeKindIds: [] },
  processCategories: ['task'],
});

function fieldsOf(ids: string[]): StructureField[] {
  return [
    { id: 'name', label: 'Название', defaultVisible: true, visible: true },
    ...ids.map((id) => ({
      id,
      label: id,
      defaultVisible: false,
      visible: true,
      group: 'attributes' as const,
    })),
  ];
}

function nodeRow(customFields: StructureNodeRow['node']['customFields']): StructureNodeRow {
  return {
    kind: 'node',
    node: {
      id: '43000000-0000-4000-8000-000000000001',
      parentId: null,
      kindId: NODE_KIND,
      name: 'Здание 1',
      code: null,
      customFields,
      rollup: ZERO_ROLLUP,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    depth: 0,
    subtree: ZERO_ROLLUP,
    hasChildren: false,
    descendantCount: 0,
  };
}

function taskRow(extra: Partial<TaskListItem> = {}): StructureTaskRow {
  return {
    kind: 'task',
    task: {
      id: '21000000-0000-4000-8000-000000000001',
      number: 201,
      title: 'Согласовать АР',
      type: {
        id: TASK_TYPE,
        code: 'std',
        name: 'Стандартный',
        category: 'task',
        icon: 'square-check',
        color: 'teal',
      },
      stage: {
        id: '32000000-0000-4000-8000-000000000001',
        name: 'В работе',
        order: 0,
        systemState: 'active',
        color: 'info',
        outcome: null,
      },
      personalStageId: null,
      priority: 'normal',
      deadline: null,
      creator: USER,
      assignee: USER,
      participants: [],
      project: null,
      parentId: null,
      nodeId: '43000000-0000-4000-8000-000000000001',
      spentMinutes: 0,
      plannedMinutes: null,
      commentsCount: 0,
      checklistDone: 0,
      checklistTotal: 0,
      source: 'manual',
      customFields: {},
      updatedAt: '2026-11-01T09:00:00.000Z',
      ...extra,
    },
    depth: 1,
    hasChildren: false,
    descendantCount: 0,
  };
}

const GRID = { templateColumns: '40px 200px 160px' };

function renderNodeRow(row: StructureNodeRow, attributeIds: string[]) {
  const attributes = new Map([
    [`cf.${NOTE_ID}`, nodeAttribute],
    [`cf.${TASK_FIELD_ID}`, taskAttribute],
  ]);
  return render(
    <DndContext>
      <StructureNodeRowView
        row={row}
        kind={undefined}
        collapsed={false}
        onToggle={vi.fn()}
        selected={false}
        active={false}
        onToggleSelected={vi.fn()}
        onSelect={vi.fn()}
        items={[]}
        zone={null}
        invalid={false}
        isDragging={false}
        fields={fieldsOf(attributeIds)}
        attributes={attributes}
        refs={new Map()}
        grid={GRID}
        showSelection={false}
        readOnly
      />
    </DndContext>,
  );
}

function renderTaskRow(row: StructureTaskRow, attributeIds: string[]) {
  const attributes = new Map([
    [`cf.${NOTE_ID}`, nodeAttribute],
    [`cf.${TASK_FIELD_ID}`, taskAttribute],
  ]);
  return render(
    <DndContext>
      <StructureTaskRowView
        row={row}
        collapsed={false}
        onToggle={vi.fn()}
        selected={false}
        onToggleSelected={vi.fn()}
        items={[]}
        onOpen={vi.fn()}
        dragData={{ kind: 'tasks', taskIds: [row.task.id] }}
        isDragging={false}
        fields={fieldsOf(attributeIds)}
        attributes={attributes}
        grid={GRID}
        showSelection={false}
        readOnly
      />
    </DndContext>,
  );
}

afterEach(cleanup);

describe('StructureNodeRowView: атрибуты папки (#632)', () => {
  it('значение атрибута папки — в своей колонке', () => {
    renderNodeRow(nodeRow({ [NOTE_ID]: 'Фасад — навесной' }), [`cf.${NOTE_ID}`]);
    expect(screen.getByText('Фасад — навесной')).toBeTruthy();
  });

  it('атрибут задачи в строке папки не показывается', () => {
    renderNodeRow(nodeRow({ [TASK_FIELD_ID]: REF_ID }), [`cf.${TASK_FIELD_ID}`]);
    expect(screen.queryByText('Сотрудник-заказчик')).toBeNull();
  });

  it('пустое значение — пустая ячейка', () => {
    const { container } = renderNodeRow(nodeRow({}), [`cf.${NOTE_ID}`]);
    expect(container.textContent).not.toContain('Не задано');
  });
});

describe('StructureTaskRowView: атрибуты задачи (#632)', () => {
  it('значение задачи и имя ссылки из её собственных customFieldRefs', () => {
    renderTaskRow(
      taskRow({
        customFields: { [TASK_FIELD_ID]: REF_ID },
        customFieldRefs: [
          { kind: 'user', id: REF_ID, name: 'Маторин Д.', avatarUrl: null, archived: false },
        ],
      }),
      [`cf.${TASK_FIELD_ID}`],
    );
    expect(screen.getByText('Маторин Д.')).toBeTruthy();
  });

  it('атрибут папки в строке задачи не показывается', () => {
    renderTaskRow(taskRow({ customFields: { [NOTE_ID]: 'Фасад — навесной' } }), [`cf.${NOTE_ID}`]);
    expect(screen.queryByText('Фасад — навесной')).toBeNull();
  });
});
