import { describe, expect, it, vi } from 'vitest';

import { StageMover, type MovableTask } from './stage-mover.js';

const TX = { tx: true } as never;

type Target = { id: string; name: string; systemState: string; outcome: string | null };

const REVIEW: Target = {
  id: 's-review',
  name: 'На утверждении',
  systemState: 'done',
  outcome: null,
};
const DONE: Target = { id: 's-done', name: 'Завершена', systemState: 'closed', outcome: 'success' };
const CANCELLED: Target = {
  id: 's-cancelled',
  name: 'Отменена',
  systemState: 'closed',
  outcome: 'cancelled',
};
const WORK: Target = { id: 's-work', name: 'В работе', systemState: 'active', outcome: null };

function setup() {
  const tasks = {
    moveToStage: vi.fn(async () => undefined),
    stageKeyAt: vi.fn(async () => 'k'),
    setState: vi.fn(async () => undefined),
  };
  const placements = { sync: vi.fn(async () => undefined) };
  const eventBus = { emit: vi.fn(async () => undefined) };
  const mover = new StageMover(tasks as never, placements as never, eventBus as never);
  const types = () => eventBus.emit.mock.calls.map((c) => (c as unknown[])[1]);
  const moved = () => (tasks.moveToStage.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
  return { mover, tasks, placements, eventBus, types, moved };
}

const task = (systemState: string, completedAt: Date | null = null): MovableTask => ({
  id: 't1',
  number: 7,
  stageId: 's-from',
  systemState,
  creatorId: 'alice',
  assigneeId: 'bob',
  completedAt,
  participants: [{ userId: 'carol', role: 'coexecutor' }],
});

const meta = { transitionId: 'tr', cause: 'transition' as const };

describe('StageMover — «Утверждение» не завершение (ADR-0020, дополнение 2)', () => {
  it('сдача на утверждение: без completedAt и без task.completed', async () => {
    const { mover, types, moved } = setup();
    await mover.apply(TX, task('active'), REVIEW, 'bob', meta);
    expect(moved()).toMatchObject({ systemState: 'done', completedAt: null });
    expect(types()).toEqual(['task.stage_changed', 'task.status_changed']);
  });

  it('утверждение (review → итог «выполнена»): completedAt ставится, task.completed', async () => {
    const { mover, types, moved } = setup();
    await mover.apply(TX, task('done'), DONE, 'alice', meta);
    expect(moved().completedAt).toBeInstanceOf(Date);
    expect(types()).toContain('task.completed');
  });

  it('устаревший completedAt задачи на утверждении не переносится в итог', async () => {
    const { mover, moved } = setup();
    const stale = new Date('2026-01-01T00:00:00Z');
    await mover.apply(TX, task('done', stale), DONE, 'alice', meta);
    expect(moved().completedAt).not.toEqual(stale);
  });

  it('завершение без утверждения (работа → итог) — тоже task.completed', async () => {
    const { mover, types } = setup();
    await mover.apply(TX, task('active'), DONE, 'bob', meta);
    expect(types()).toContain('task.completed');
  });

  it('отмена: completedAt — момент итога, но task.completed не шлётся', async () => {
    const { mover, types, moved } = setup();
    await mover.apply(TX, task('done'), CANCELLED, 'alice', meta);
    expect(moved().completedAt).toBeInstanceOf(Date);
    expect(types()).not.toContain('task.completed');
  });

  it('итог → итог: completedAt сохраняется, повторного task.completed нет', async () => {
    const { mover, types, moved } = setup();
    const at = new Date('2026-10-01T10:00:00Z');
    await mover.apply(TX, task('closed', at), DONE, 'alice', meta);
    expect(moved().completedAt).toBe(at);
    expect(types()).toEqual(['task.stage_changed']);
  });

  it('возврат на доработку: completedAt снимается', async () => {
    const { mover, moved } = setup();
    await mover.apply(TX, task('done'), WORK, 'alice', meta);
    expect(moved()).toMatchObject({ systemState: 'active', completedAt: null });
  });

  it('пересчёт группы статуса (публикация): итог ставит completedAt без task.completed', async () => {
    const { mover, tasks, types } = setup();
    await mover.restate(TX, task('done'), 'closed');
    const state = (tasks.setState.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(state.completedAt).toBeInstanceOf(Date);
    expect(types()).toEqual(['task.status_changed']);
  });

  it('пересчёт в «Утверждение»: completedAt снимается', async () => {
    const { mover, tasks } = setup();
    await mover.restate(TX, task('closed', new Date()), 'done');
    const state = (tasks.setState.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(state).toMatchObject({ systemState: 'done', completedAt: null });
  });
});

describe('StageMover — payload stage_changed (#380)', () => {
  it('обход гейта: overriddenGates и reason (регресс #428), поля окна и recordId', async () => {
    const { mover, eventBus } = setup();
    const recordId = '00000000-0000-4000-8000-0000000000aa';
    await mover.apply(TX, task('active'), REVIEW, 'bob', {
      transitionId: 'tr',
      cause: 'transition',
      overriddenGates: ['no_open_subtasks'],
      overrideReason: 'срочно',
      recordId,
      transitionName: 'Завершить',
      fromStageName: 'В работе',
      comment: 'Готово',
      commentLabel: 'Комментарий',
      result: { resultId: '00000000-0000-4000-8000-0000000000bb', fileCount: 2, messageCount: 1 },
    });
    const payload = (eventBus.emit.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(payload).toMatchObject({
      overriddenGates: ['no_open_subtasks'],
      reason: 'срочно',
      recordId,
      transitionName: 'Завершить',
      fromStageName: 'В работе',
      comment: 'Готово',
      commentLabel: 'Комментарий',
      result: { fileCount: 2, messageCount: 1 },
    });
  });

  it('длинные строки обрезаются до лимитов контракта события', async () => {
    const { mover, eventBus } = setup();
    await mover.apply(TX, task('active'), REVIEW, 'bob', {
      transitionId: 'tr',
      cause: 'transition',
      transitionName: 'я'.repeat(50),
      fromStageName: 'я'.repeat(60),
      comment: 'я'.repeat(2100),
      commentLabel: 'я'.repeat(70),
    });
    const payload = (eventBus.emit.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect((payload.transitionName as string).length).toBe(32);
    expect((payload.fromStageName as string).length).toBe(40);
    expect((payload.comment as string).length).toBe(2000);
    expect((payload.commentLabel as string).length).toBe(60);
  });

  it('окно сменило ответственного — в событии прежний ответственный (#741)', async () => {
    const { mover, eventBus } = setup();
    await mover.apply(TX, task('active'), REVIEW, 'bob', {
      transitionId: 'tr',
      cause: 'transition',
      fieldChanges: { assignee: { from: 'alice', to: 'bob' } },
    });
    const payload = (eventBus.emit.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(payload).toMatchObject({ assigneeId: 'bob', previousAssigneeId: 'alice' });
  });

  it('без смены ответственного поля previousAssigneeId в событии нет', async () => {
    const { mover, eventBus } = setup();
    await mover.apply(TX, task('active'), REVIEW, 'bob', {
      transitionId: 'tr',
      cause: 'transition',
      fieldChanges: { deadline: { from: null, to: '2026-12-01T00:00:00.000Z' } },
    });
    const payload = (eventBus.emit.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('previousAssigneeId');
  });
});
