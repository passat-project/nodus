import type { NodeKind, ProjectNode, ProjectNodeRollup } from '@nodus/contracts';
import { isCompletedState, isOpenState, NODE_LIMITS } from '@nodus/contracts';

import { isoAgo } from './dates.js';
import { nodeIds } from './project-node-ids.js';
import { demoTasks } from './tasks.js';
import { projectRefs } from './task-item-factory.js';

/** Структура демо-проектов (#467, ADR-0030): виды уровней (справочник
 *  «Автоматизации», посев по ТКП 45-1.02-295) и узлы-папки демо-проекта p4.
 *  Rollup-агрегаты узла считаются по ПРЯМЫМ задачам (tasks.nodeId) при каждом
 *  чтении — структура всегда отвечает свежим срезом мок-мира. Порядок
 *  сиблингов = порядок строк в массиве (move переставляет splice'ом). */

const kindId = (n: number): string => `44000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Виды уровней — ярлыки узлов (значок + цвет). */
export const nodeKindIds = {
  stage: kindId(1),
  queue: kindId(2),
  startup: kindId(3),
  building: kindId(4),
  section: kindId(5),
  phase: kindId(6),
} as const;

export const demoNodeKinds: NodeKind[] = [
  { id: nodeKindIds.stage, name: 'Стадия', icon: 'layers', color: 'amber', archivedAt: null },
  { id: nodeKindIds.queue, name: 'Очередь', icon: 'route', color: 'blue', archivedAt: null },
  {
    id: nodeKindIds.startup,
    name: 'Пусковой комплекс',
    icon: 'milestone',
    color: 'green',
    archivedAt: null,
  },
  {
    id: nodeKindIds.building,
    name: 'Здание по генплану',
    icon: 'building',
    color: 'sky',
    archivedAt: null,
  },
  { id: nodeKindIds.section, name: 'Раздел', icon: 'listTree', color: 'pink', archivedAt: null },
  { id: nodeKindIds.phase, name: 'Этап', icon: 'flag', color: 'terra', archivedAt: null },
];

/** Строка узла мок-мира (до гидратации rollup). */
export interface DemoNodeRow {
  id: string;
  projectId: string;
  parentId: string | null;
  kindId: string;
  name: string;
  code: string | null;
  createdAt: string;
}

/** Дерево демо-проекта p4 «Главный корпус галургической фабрики»:
 *  Здание 1 → разделы АР/КР/ИОС, Здание 2 → АР (модель «папки в проводнике»). */
export const demoNodeRows: DemoNodeRow[] = [
  {
    id: nodeIds.b1,
    projectId: projectRefs.p4.id,
    parentId: null,
    kindId: nodeKindIds.building,
    name: 'Здание 1',
    code: null,
    createdAt: isoAgo(80),
  },
  {
    id: nodeIds.b1ar,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b1,
    kindId: nodeKindIds.section,
    name: 'Архитектурные решения',
    code: 'АР',
    createdAt: isoAgo(79),
  },
  {
    id: nodeIds.b1kr,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b1,
    kindId: nodeKindIds.section,
    name: 'Конструктивные решения',
    code: 'КР',
    createdAt: isoAgo(78),
  },
  {
    id: nodeIds.b1ios,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b1,
    kindId: nodeKindIds.section,
    name: 'Инженерное обеспечение',
    code: 'ИОС',
    createdAt: isoAgo(77),
  },
  {
    id: nodeIds.b2,
    projectId: projectRefs.p4.id,
    parentId: null,
    kindId: nodeKindIds.building,
    name: 'Здание 2',
    code: null,
    createdAt: isoAgo(50),
  },
  {
    id: nodeIds.b2ar,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b2,
    kindId: nodeKindIds.section,
    name: 'Архитектурные решения',
    code: 'АР',
    createdAt: isoAgo(49),
  },
];

export function findDemoNodeRow(id: string): DemoNodeRow | undefined {
  return demoNodeRows.find((row) => row.id === id);
}

export function nodesOfProject(projectId: string): DemoNodeRow[] {
  return demoNodeRows.filter((row) => row.projectId === projectId);
}

/** Прямые задачи узла (листья дерева, tasks.nodeId). */
export function directTasksOf(nodeId: string) {
  return demoTasks.filter((task) => task.nodeId === nodeId);
}

/** Агрегаты ПРЯМЫХ задач узла (порт TASK_PROJECT_READER.nodeRollups):
 *  nearest — MIN(deadline) открытых, latest — MAX(deadline) всех. */
export function rollupOfNode(nodeId: string): ProjectNodeRollup {
  const tasks = directTasksOf(nodeId);
  const withDeadline = tasks.filter((t) => t.deadline !== null);
  const openDeadlines = tasks
    .filter((t) => t.deadline !== null && isOpenState(t.stage.systemState))
    .map((t) => t.deadline as string);
  return {
    taskCount: tasks.length,
    doneCount: tasks.filter((t) => isCompletedState(t.stage.systemState, t.stage.outcome)).length,
    plannedMinutes: tasks.reduce((sum, t) => sum + (t.plannedMinutes ?? 0), 0),
    spentMinutes: tasks.reduce((sum, t) => sum + t.spentMinutes, 0),
    nearestDeadline:
      openDeadlines.length > 0 ? openDeadlines.reduce((a, b) => (a < b ? a : b)) : null,
    latestDeadline:
      withDeadline.length > 0
        ? withDeadline.map((t) => t.deadline as string).reduce((a, b) => (a > b ? a : b))
        : null,
  };
}

export function projectNodeDto(row: DemoNodeRow): ProjectNode {
  return {
    id: row.id,
    parentId: row.parentId,
    kindId: row.kindId,
    name: row.name,
    code: row.code,
    rollup: rollupOfNode(row.id),
    createdAt: row.createdAt,
  };
}

/** Сводка структуры для карточки проекта (дефолт вкладки: «Структура»
 *  первична, когда есть узел с прямыми задачами-детьми). */
export function structureSummaryOf(projectId: string): {
  nodeCount: number;
  hasTaskNodes: boolean;
} {
  const nodes = nodesOfProject(projectId);
  return {
    nodeCount: nodes.length,
    hasTaskNodes: nodes.some((node) => directTasksOf(node.id).length > 0),
  };
}

/** Дети узла (null — корни) в порядке массива (порядок сиблингов =
 *  позиция в demoNodeRows). */
export function childNodeRows(parentId: string | null, projectId: string): DemoNodeRow[] {
  return demoNodeRows.filter((row) => row.projectId === projectId && row.parentId === parentId);
}

/** Все потомки узла (для блокировки циклов при переносе). */
export function descendantIdsOf(nodeId: string): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const row of demoNodeRows) {
      if (row.parentId === id && !out.has(row.id)) {
        out.add(row.id);
        walk(row.id);
      }
    }
  };
  walk(nodeId);
  return out;
}

/** Глубина узла от корня (лимит NODE_LIMITS.depth). */
export function nodeDepthOf(row: DemoNodeRow): number {
  let depth = 0;
  let current: DemoNodeRow | undefined = row;
  while (current?.parentId) {
    current = findDemoNodeRow(current.parentId);
    depth += 1;
    if (depth > NODE_LIMITS.depth) break;
  }
  return depth;
}

/** Шифр узла уникален в проекте (кроме самого узла при правке). */
export function nodeCodeTaken(code: string, projectId: string, exceptId: string | null): boolean {
  return demoNodeRows.some(
    (row) => row.projectId === projectId && row.code === code && row.id !== exceptId,
  );
}
