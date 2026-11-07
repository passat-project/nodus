import { useMemo, useState } from 'react';
import type {
  CustomFieldDefinition,
  CustomFieldRef,
  NodeKind,
  ProjectNode,
} from '@nodus/contracts';

import { attributeRefs } from '../../../../shared/views/attribute-fields.js';
import { useListToolbar } from '../../../../shared/views/use-list-toolbar.js';
import { useRowSelection } from '../../../../shared/views/use-row-selection.js';
import { useViewFields } from '../../../../shared/views/use-view-fields.js';
import { useProjectTaskPages } from '../../api/projects-api.js';
import { useProjectStructure } from '../api/structure-api.js';
import { STRUCTURE_VIEW_KEY, structureGrid, useStructureFields } from './structure-fields.js';
import {
  buildStructureRows,
  filterStructureRows,
  filterVisibleRows,
  type StructureNoNodeRow,
  type StructureNodeRow,
  type StructureRow,
  type StructureTaskRow,
} from './structure-tree.js';
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set();

const rowKey = (row: StructureNodeRow | StructureTaskRow): string =>
  row.kind === 'node' ? `n:${row.node.id}` : `t:${row.task.id}`;

/** Состояние и производные данные вкладки «Структура»: дерево, поиск,
 *  сворачивание, колонки, выбор строк. Вынесено из компонента (I5) —
 *  вкладка остаётся про действия и композицию. */
export function useStructureModel(projectId: string) {
  const { data: structure, isLoading } = useProjectStructure(projectId);
  const tasksQuery = useProjectTaskPages(projectId);
  const toolbar = useListToolbar('projects.structure');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [noNodeCollapsed, setNoNodeCollapsed] = useState(false);
  // Реестр колонок — с атрибутами папок и задач (#632); атрибуты скрыты по
  // умолчанию, включённые приходят из пресета вида.
  const fields = useStructureFields();
  const {
    fields: viewFields,
    visibleFields,
    sort,
    setWidth,
    cycleSort,
    commitOrder,
  } = useViewFields(STRUCTURE_VIEW_KEY, fields);

  const tasks = useMemo(
    () => tasksQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [tasksQuery.data],
  );
  const nodes = useMemo<ProjectNode[]>(() => structure?.nodes ?? [], [structure]);
  const kinds = useMemo<NodeKind[]>(() => structure?.kinds ?? [], [structure]);
  const kindById = useMemo(() => new Map(kinds.map((l) => [l.id, l])), [kinds]);
  const customFieldRefs = useMemo<CustomFieldRef[]>(
    () => structure?.customFieldRefs ?? [],
    [structure],
  );
  // Ссылки значений папок — карта по id (одним срезом на весь проект, О2).
  const nodeRefs = useMemo(() => attributeRefs({ customFieldRefs }), [customFieldRefs]);
  // Определения атрибутных колонок по id поля: ячейка рендерит значение по
  // грамматике типа, не зная, из какого модуля пришёл атрибут.
  const attributeDefinitions = useMemo(() => {
    const map = new Map<string, CustomFieldDefinition>();
    for (const field of viewFields) {
      if (field.attribute) map.set(field.id, field.attribute);
    }
    return map;
  }, [viewFields]);
  const rows = useMemo(() => buildStructureRows(nodes, tasks), [nodes, tasks]);
  const filtered = useMemo(() => filterStructureRows(rows, toolbar.query), [rows, toolbar.query]);
  const visible = useMemo(
    () => filterVisibleRows(filtered, toolbar.query ? EMPTY_COLLAPSED : collapsed),
    [filtered, collapsed, toolbar.query],
  );
  const noNodeIndex = visible.findIndex((row) => row.kind === 'noNode');
  const treeRows = useMemo(
    () => (noNodeIndex >= 0 ? visible.slice(0, noNodeIndex) : visible),
    [visible, noNodeIndex],
  );
  const noNodeRow = useMemo(
    () => (noNodeIndex >= 0 ? (visible[noNodeIndex] as StructureNoNodeRow) : null),
    [visible, noNodeIndex],
  );
  const noNodeTasks = useMemo(
    () => (noNodeRow && (!noNodeCollapsed || toolbar.query) ? visible.slice(noNodeIndex + 1) : []),
    [noNodeRow, noNodeCollapsed, toolbar.query, visible, noNodeIndex],
  );
  const visibleRows = useMemo<StructureRow[]>(
    () => [...treeRows, ...(noNodeRow ? [noNodeRow] : []), ...noNodeTasks],
    [treeRows, noNodeRow, noNodeTasks],
  );
  const rowKeys = useMemo(
    () =>
      visibleRows.flatMap((row) =>
        row.kind === 'noNode' ? [] : [rowKey(row as StructureNodeRow | StructureTaskRow)],
      ),
    [visibleRows],
  );
  const selection = useRowSelection(rowKeys);
  const selectedNodeIds = useMemo(
    () => [...selection.selected].filter((key) => key.startsWith('n:')).map((key) => key.slice(2)),
    [selection.selected],
  );
  const selectedTaskIds = useMemo(
    () => [...selection.selected].filter((key) => key.startsWith('t:')).map((key) => key.slice(2)),
    [selection.selected],
  );
  const branchIds = useMemo(
    () =>
      rows.flatMap((r) =>
        r.kind === 'node' && r.hasChildren
          ? [r.node.id]
          : r.kind === 'task' && r.hasChildren
            ? [r.task.id]
            : [],
      ),
    [rows],
  );
  const gridTemplateColumns = structureGrid(visibleFields);

  return {
    isLoading,
    toolbar,
    collapsed,
    setCollapsed,
    noNodeCollapsed,
    setNoNodeCollapsed,
    /** Полный реестр колонок вида — шестерёнка показывает его целиком. */
    fields: viewFields,
    visibleFields,
    sort,
    setWidth,
    cycleSort,
    commitOrder,
    tasks,
    nodes,
    kinds,
    kindById,
    customFieldRefs,
    nodeRefs,
    attributeDefinitions,
    rows,
    filtered,
    treeRows,
    noNodeRow,
    noNodeTasks,
    selection,
    selectedNodeIds,
    selectedTaskIds,
    branchIds,
    gridTemplateColumns,
  };
}
