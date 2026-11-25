/**
 * Ключ первой страницы колонки канбана (#322): доска держит отдельный запрос
 * на колонку — `[...boardKey, 'column', stageId]`, где boardKey — ключ доски
 * фичи (`tasksKeys.kanban(scope)`). Префикс доски по-прежнему инвалидирует
 * все её колонки (мутации), а WS-событие задачи — только затронутые.
 */
const COLUMN_SEGMENT = 'column';

export function kanbanColumnKey(boardKey: readonly unknown[], stageId: string) {
  return [...boardKey, COLUMN_SEGMENT, stageId] as const;
}

/** Префикс всех колонок доски: перезапрос после переноса, пометка устаревшим. */
export function kanbanColumnPrefix(boardKey: readonly unknown[]) {
  return [...boardKey, COLUMN_SEGMENT] as const;
}

/** id колонки из ключа запроса колонки; не колонка — null. */
export function stageIdOfColumnKey(key: readonly unknown[]): string | null {
  const at = key.lastIndexOf(COLUMN_SEGMENT);
  const stageId = at >= 0 && at === key.length - 2 ? key[at + 1] : null;
  return typeof stageId === 'string' ? stageId : null;
}
