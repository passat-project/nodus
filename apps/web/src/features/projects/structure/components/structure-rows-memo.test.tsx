// @vitest-environment jsdom
import { DndContext } from '@dnd-kit/core';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';

import type { StructureNodeRowProps, StructureTaskRowProps } from './structure-row-props.js';
import type { StructureNodeRow, StructureTaskRow } from '../lib/structure-tree.js';
import { StructureNodeRowView, StructureTaskRowView } from './structure-rows.js';

/**
 * A6-4 (#632): строки дерева структуры перерисовывались ВСЕ на любой рендер
 * вкладки (наведение, зона дропа, выбор). Пропсы строк приходят из
 * `structure-row-list` новыми стрелками и новыми массивами на каждый рендер
 * родителя — memo обязан держаться на данных строки.
 *
 * Счётчик рендеров строки — вызовы `useDraggable` (один на фактический
 * рендер компонента).
 */

const dndCalls = vi.hoisted(() => ({ draggable: 0 }));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    useDraggable: (...args: Parameters<typeof actual.useDraggable>) => {
      dndCalls.draggable += 1;
      return actual.useDraggable(...args);
    },
  };
});

const NOTE_ID = '55000000-0000-4000-8000-000000000001';
const NODE_KIND = '44000000-0000-4000-8000-000000000001';

const ZERO_ROLLUP = {
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
};

const NODE_ATTRIBUTE: CustomFieldDefinition = {
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
};

const GRID = { templateColumns: '40px 200px' };
const noop = () => {};

const NODE_ROW: StructureNodeRow = {
  kind: 'node',
  node: {
    id: '43000000-0000-4000-8000-000000000001',
    parentId: null,
    kindId: NODE_KIND,
    name: 'Здание 1',
    code: null,
    customFields: {},
    rollup: ZERO_ROLLUP,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  depth: 0,
  subtree: ZERO_ROLLUP,
  hasChildren: false,
  descendantCount: 0,
};

const TASK_ROW: StructureTaskRow = {
  kind: 'task',
  task: {
    id: '21000000-0000-4000-8000-000000000001',
    number: 201,
    title: 'Согласовать АР',
    type: {
      id: '31000000-0000-4000-8000-000000000001',
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
    creator: { id: 'u1', displayName: 'Тест Тест', avatarUrl: null },
    assignee: null,
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
  },
  depth: 1,
  hasChildren: false,
  descendantCount: 0,
};

/** Базовые пропсы: данные строки создаются ОДИН раз — как в реальном списке,
 *  где `row` приходит из модели вида, а не пересобирается на каждый рендер. */
const NODE_PROPS: StructureNodeRowProps = {
  row: NODE_ROW,
  kind: undefined,
  collapsed: false,
  onToggle: noop,
  selected: false,
  onToggleSelected: noop,
  onSelect: noop,
  items: [],
  zone: null,
  invalid: false,
  isDragging: false,
  fields: [{ id: 'name', label: 'Название', defaultVisible: true, visible: true }],
  attributes: new Map([[`cf.${NOTE_ID}`, NODE_ATTRIBUTE]]),
  refs: new Map(),
  grid: GRID,
  showSelection: false,
  readOnly: true,
};

const TASK_PROPS: StructureTaskRowProps = {
  row: TASK_ROW,
  collapsed: false,
  onToggle: noop,
  selected: true,
  onToggleSelected: noop,
  items: [],
  onOpen: noop,
  dragData: { kind: 'tasks', taskIds: ['t1', 't2'] },
  isDragging: false,
  fields: [{ id: 'name', label: 'Название', defaultVisible: true, visible: true }],
  attributes: NODE_PROPS.attributes,
  grid: GRID,
  showSelection: true,
  readOnly: false,
};

const withDnd = (row: ReactElement) => <DndContext>{row}</DndContext>;

afterEach(cleanup);

describe('Строки дерева: мемоизация (A6-4)', () => {
  it('папка: новые ссылки колбэков и меню — без рендера, смена зоны — рендер', () => {
    const items = [{ id: 'open', label: 'Открыть', onSelect: noop }];
    dndCalls.draggable = 0;
    const { rerender } = render(withDnd(<StructureNodeRowView {...NODE_PROPS} items={items} />));
    const renders = dndCalls.draggable;
    expect(renders).toBe(1);

    // Родитель перерисовался: новые стрелки и новый массив меню, данные те же.
    rerender(
      withDnd(
        <StructureNodeRowView
          {...NODE_PROPS}
          onToggle={() => {}}
          onSelect={() => {}}
          items={[{ id: 'open', label: 'Открыть', onSelect: noop }]}
        />,
      ),
    );
    expect(dndCalls.draggable).toBe(renders);

    rerender(withDnd(<StructureNodeRowView {...NODE_PROPS} items={items} zone="into" />));
    expect(dndCalls.draggable).toBe(renders + 1);
  });

  it('задача: payload переноса сравнивается по содержимому выборки', () => {
    dndCalls.draggable = 0;
    const { rerender } = render(withDnd(<StructureTaskRowView {...TASK_PROPS} />));
    const renders = dndCalls.draggable;

    // Новая ссылка массива с тем же составом — строка не перерисовывается.
    rerender(
      withDnd(
        <StructureTaskRowView
          {...TASK_PROPS}
          dragData={{ kind: 'tasks', taskIds: ['t1', 't2'] }}
        />,
      ),
    );
    expect(dndCalls.draggable).toBe(renders);

    // Состав выборки изменился — строка обязана получить новый payload.
    rerender(
      withDnd(
        <StructureTaskRowView {...TASK_PROPS} dragData={{ kind: 'tasks', taskIds: ['t1'] }} />,
      ),
    );
    expect(dndCalls.draggable).toBe(renders + 1);
  });
});
