import { describe, expect, it } from 'vitest';

import { pressRoundViewOf } from './press-view.js';
import type { PressRoundRow } from './press.repository.js';

const entry = (userId: string, order: number, state: string) => ({
  id: `e-${userId}`,
  roundId: 'r1',
  userId,
  order,
  state,
  pressedAt: state === 'pressed' ? new Date('2026-11-09T10:00:00Z') : null,
  input: null,
  result:
    state === 'pressed'
      ? { text: 'Готово', messageIds: [], fileCount: 0, minutes: null, date: null }
      : null,
  timeEntryId: null,
  returnReason: null,
  createdAt: new Date('2026-11-09T09:00:00Z'),
  updatedAt: new Date('2026-11-09T09:00:00Z'),
});

function round(overrides: Partial<PressRoundRow> = {}): PressRoundRow {
  return {
    id: 'r1',
    entityKind: 'task',
    entityId: 't1',
    stageId: 's1',
    transitionId: 'tr1',
    transitionName: 'Ознакомлен',
    cycle: 1,
    config: {
      sources: [{ kind: 'coexecutors' }],
      quorum: { kind: 'all' },
      order: 'parallel',
      excludeAuthor: true,
    },
    form: { enabled: false, sections: [] },
    startedAt: new Date('2026-11-09T09:00:00Z'),
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-11-09T09:00:00Z'),
    updatedAt: new Date('2026-11-09T09:00:00Z'),
    entries: [
      entry('u1', 0, 'waiting'),
      entry('u2', 1, 'pressed'),
      entry('u3', 2, 'pressed'),
      entry('u4', 3, 'excluded'),
    ],
    ...overrides,
  } as PressRoundRow;
}

const names = (id: string) => `Сотрудник ${id}`;

describe('PressRoundView (#434)', () => {
  it('прогресс без снятых, права ждущего и нажавшего', () => {
    const waiting = pressRoundViewOf(round(), 'u1', names);
    expect(waiting).toMatchObject({
      total: 3,
      pressed: 2,
      canSubmit: true,
      canWithdraw: false,
      completed: false,
    });
    const pressed = pressRoundViewOf(round(), 'u2', names);
    expect(pressed.canSubmit).toBe(false);
    expect(pressed.canWithdraw).toBe(true);
    expect(pressed.myEntry?.result?.text).toBe('Готово');
  });

  it('по очереди: кнопку видит только первый ждущий', () => {
    const sequential = round({
      config: {
        sources: [{ kind: 'coexecutors' }],
        quorum: { kind: 'all' },
        order: 'sequential',
        excludeAuthor: true,
      },
      entries: [entry('u1', 0, 'pressed'), entry('u2', 1, 'waiting'), entry('u3', 2, 'waiting')],
    });
    expect(pressRoundViewOf(sequential, 'u2', names).canSubmit).toBe(true);
    expect(pressRoundViewOf(sequential, 'u3', names).canSubmit).toBe(false);
  });

  it('возврат: только ответственный/право правки и пока раунд открыт', () => {
    expect(pressRoundViewOf(round(), 'owner', names, true).canReturn).toBe(true);
    expect(pressRoundViewOf(round(), 'u1', names, false).canReturn).toBe(false);
    expect(
      pressRoundViewOf(round({ completedAt: new Date() }), 'owner', names, true).canReturn,
    ).toBe(false);
  });

  it('после кворума нажатия и отзыв закрыты', () => {
    const done = pressRoundViewOf(round({ completedAt: new Date() }), 'u1', names);
    expect(done).toMatchObject({ completed: true, canSubmit: false, canWithdraw: false });
  });
});
