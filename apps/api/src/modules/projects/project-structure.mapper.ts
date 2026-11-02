import type { ProjectNode, ProjectNodeRollup } from '@nodus/contracts';

import type { ProjectNodeRow } from './project-nodes.repository.js';

/** Агрегат узла без задач (узел-папка без прямых задач — нули). */
export const EMPTY_ROLLUP: ProjectNodeRollup = {
  taskCount: 0,
  doneCount: 0,
  plannedMinutes: 0,
  spentMinutes: 0,
  nearestDeadline: null,
  latestDeadline: null,
};

/** Строка БД → DTO узла (rollup=null → пустой агрегат). */
export function nodeToDto(row: ProjectNodeRow, rollup: ProjectNodeRollup | null): ProjectNode {
  return {
    id: row.id,
    parentId: row.parentId,
    kindId: row.kindId,
    name: row.name,
    code: row.code,
    rollup: rollup ?? EMPTY_ROLLUP,
    createdAt: row.createdAt.toISOString(),
  };
}
