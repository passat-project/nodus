import { useCallback, type RefObject } from 'react';

import { cellContentWidth, COLUMN_BREATHING } from './column-content.js';

/** Автоподбор ширины колонки по контенту (двойной клик на ручке, как в
 *  Excel): суммирует контентные ширины детей ячеек колонки (scrollWidth
 *  самой ячейки не подходит — он не меньше её текущей ширины) + дыхание
 *  24px. leadingOffset — сдвиг индекса на служебные колонки слева
 *  (DataTable: 1 — ведущая; TaskList: 2 — ведущая + колонка графа).
 *  Одна механика обеих таблиц (аудит #45 — была копией). */
export function useAutoFitColumn(
  containerRef: RefObject<HTMLElement | null>,
  leadingOffset: 1 | 2,
  setWidth: (fieldId: string, width: number) => void,
) {
  return useCallback(
    (fieldIndex: number, fieldId: string, minWidth: number, maxWidth: number) => {
      const container = containerRef.current;
      if (!container) return;
      let max = 0;
      for (const row of container.children) {
        const cell = row.children[fieldIndex + leadingOffset] as HTMLElement | undefined;
        if (cell) max = Math.max(max, cellContentWidth(cell));
      }
      if (max > 0) {
        setWidth(
          fieldId,
          Math.min(maxWidth, Math.max(minWidth, Math.ceil(max) + COLUMN_BREATHING)),
        );
      }
    },
    [containerRef, leadingOffset, setWidth],
  );
}
