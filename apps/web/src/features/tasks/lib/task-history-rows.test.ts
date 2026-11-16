import { describe, expect, it } from 'vitest';
import { TASK_EVENTS, ui, type TaskHistoryItem } from '@nodus/contracts';

import { actionHistoryRows } from './task-history-rows.js';

const item = (overrides: Partial<TaskHistoryItem> = {}): TaskHistoryItem =>
  ({
    id: 'e1',
    type: TASK_EVENTS.ACTION_PRESSED,
    actor: { id: 'u1', displayName: 'Администратор' },
    payload: { actionName: 'Добавить замечание', stageName: 'В работе' },
    createdAt: '2026-11-16T10:00:00.000Z',
    ...overrides,
  }) as TaskHistoryItem;

describe('actionHistoryRows — нажатия действий в «Истории» (#633, аудит Б3)', () => {
  it('нажатие действия — строка «Действие: X · в статусе Y» с автором и временем', () => {
    expect(actionHistoryRows([item()])).toEqual([
      {
        id: 'e1',
        text: `${ui.tasks.historyAction}: Добавить замечание · ${ui.tasks.historyInStage} В работе`,
        at: '2026-11-16T10:00:00.000Z',
        actor: 'Администратор',
      },
    ]);
  });

  it('прочие события журнала в «Историю» действий не попадают', () => {
    expect(
      actionHistoryRows([item({ type: TASK_EVENTS.UPDATED }), item({ id: 'e2' })]).map(
        (row) => row.id,
      ),
    ).toEqual(['e2']);
  });

  it('нажатие без автора (системное) не ломает строку', () => {
    const [row] = actionHistoryRows([item({ actor: null })]);
    expect(row?.actor).toBe('');
    expect(row?.text).toContain('Добавить замечание');
  });
});
