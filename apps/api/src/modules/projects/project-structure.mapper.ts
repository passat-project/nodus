import {
  SYSTEM_FIELD_IDS,
  type CustomFieldFormulas,
  type CustomFieldValues,
  type ProjectNode,
  type ProjectNodeRollup,
} from '@nodus/contracts';

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

/** Строка БД → DTO узла (rollup=null → пустой агрегат). `customFields` —
 *  ВСЕ хранимые значения, включая скрытые сменой вида (Р5): форма вида
 *  фильтрует помощником nodeFormValues. `formulas` — формульные ячейки
 *  папки (#632, Р9): своя/типовая формула и ошибка. */
export function nodeToDto(
  row: ProjectNodeRow,
  rollup: ProjectNodeRollup | null,
  formulas?: CustomFieldFormulas,
): ProjectNode {
  return {
    id: row.id,
    parentId: row.parentId,
    kindId: row.kindId,
    name: row.name,
    code: nodeCodeOf((row.customFields ?? {}) as CustomFieldValues),
    customFields: (row.customFields ?? {}) as CustomFieldValues,
    ...(formulas ? { customFieldFormulas: formulas } : {}),
    rollup: rollup ?? EMPTY_ROLLUP,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Код папки из значений атрибутов (системный «Код», Р9 #631; колонка
 *  project_nodes.code заморожена — не читается). */
function nodeCodeOf(customFields: CustomFieldValues): string | null {
  const value = customFields[SYSTEM_FIELD_IDS.nodeCode];
  return typeof value === 'string' && value !== '' ? value : null;
}
