import { TASK_EVENTS, ui, type TaskHistoryItem } from '@nodus/contracts';

/** Строка журнала нажатия действия (#633, аудит Б3): «Действие: X · в статусе Y». */
export interface ActionHistoryRow {
  id: string;
  text: string;
  at: string;
  actor: string;
}

/**
 * Отбор нажатий действий из журнала задачи. Строка «Истории» — источник
 * правды: она остаётся, даже если чат выключен и нажавший не состоит в беседе
 * задачи (аудит Б3). Остальные события журнала здесь не показываются —
 * «История» карточки пока ведёт только нажатия.
 */
export function actionHistoryRows(items: readonly TaskHistoryItem[]): ActionHistoryRow[] {
  return items
    .filter((item) => item.type === TASK_EVENTS.ACTION_PRESSED)
    .map((item) => {
      const name = typeof item.payload.actionName === 'string' ? item.payload.actionName : '';
      const stage = typeof item.payload.stageName === 'string' ? item.payload.stageName : '';
      return {
        id: item.id,
        text: `${ui.tasks.historyAction}: ${name} · ${ui.tasks.historyInStage} ${stage}`,
        at: item.createdAt,
        actor: item.actor?.displayName ?? '',
      };
    });
}
