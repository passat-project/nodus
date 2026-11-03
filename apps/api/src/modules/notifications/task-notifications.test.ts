import { describe, expect, it } from 'vitest';

import { taskNotices } from './task-notifications.js';

describe('taskNotices', () => {
  it('создание: ответственному и соисполнителям, не себе', () => {
    const n = taskNotices(
      'task.created',
      { number: 7, title: 'Справка', assigneeId: 'a', coexecutorIds: ['c', 'me'] },
      'me',
    );
    expect(n.map((x) => [x.userId, x.kind])).toEqual([
      ['a', 'action.assignment'],
      ['c', 'action.assignment'],
    ]);
    expect(n[0]!.preview).toBe('ПП-7 · Справка');
  });

  it('завершение — постановщику, возврат — ответственному', () => {
    const base = { number: 1, toStageName: 'Завершена', creatorId: 'cr', assigneeId: 'as' };
    expect(
      taskNotices(
        'task.stage_changed',
        { ...base, fromState: 'active', toState: 'closed', toStageOutcome: 'success' },
        'as',
      ),
    ).toMatchObject([{ userId: 'cr', kind: 'task.completed' }]);
    expect(
      taskNotices('task.stage_changed', { ...base, fromState: 'done', toState: 'active' }, 'cr'),
    ).toMatchObject([{ userId: 'as', kind: 'task.returned' }]);
    expect(
      taskNotices('task.stage_changed', { ...base, fromState: 'backlog', toState: 'active' }, 'as'),
    ).toEqual([]);
  });

  it('вход в «Утверждение» — постановщику awaiting_approval, кроме нажавшего (#378)', () => {
    const base = { number: 3, toStageName: 'На утверждении', creatorId: 'cr', assigneeId: 'as' };
    expect(
      taskNotices(
        'task.stage_changed',
        { ...base, fromState: 'active', toState: 'done', toStageOutcome: null },
        'as',
      ),
    ).toMatchObject([{ userId: 'cr', kind: 'task.awaiting_approval' }]);
    // Постановщик сам нажал — тишина.
    expect(
      taskNotices(
        'task.stage_changed',
        { ...base, fromState: 'active', toState: 'done', toStageOutcome: null },
        'cr',
      ),
    ).toEqual([]);
  });

  it('отмена — исполнителю и соисполнителям, кроме нажавшего; наблюдателю — нет (#378)', () => {
    const base = {
      number: 4,
      toStageName: 'Отменена',
      creatorId: 'cr',
      assigneeId: 'as',
      coexecutorIds: ['co'],
      audience: ['cr', 'as', 'co', 'ob'],
    };
    expect(
      taskNotices(
        'task.stage_changed',
        { ...base, fromState: 'active', toState: 'closed', toStageOutcome: 'cancelled' },
        'cr',
      ),
    ).toMatchObject([
      { userId: 'as', kind: 'task.cancelled' },
      { userId: 'co', kind: 'task.cancelled' },
    ]);
    // Выполнена — прежнее правило (постановщику), не «отменена».
    expect(
      taskNotices(
        'task.stage_changed',
        {
          number: 5,
          toStageName: 'Завершена',
          creatorId: 'cr',
          assigneeId: 'as',
          fromState: 'active',
          toState: 'closed',
          toStageOutcome: 'success',
        },
        'as',
      ),
    ).toMatchObject([{ userId: 'cr', kind: 'task.completed' }]);
  });

  it('отклонена — автору и исполнителю, не «работа принята» (#430)', () => {
    const base = { number: 7, toStageName: 'Отклонена', creatorId: 'cr', assigneeId: 'as' };
    expect(
      taskNotices(
        'task.stage_changed',
        { ...base, fromState: 'done', toState: 'closed', toStageOutcome: 'rejected' },
        'cr',
      ),
    ).toMatchObject([{ userId: 'as', kind: 'task.rejected' }]);
    expect(
      taskNotices(
        'task.stage_changed',
        { ...base, fromState: 'done', toState: 'closed', toStageOutcome: 'rejected' },
        'as',
      ),
    ).toMatchObject([{ userId: 'cr', kind: 'task.rejected' }]);
  });

  it('утверждение (с «Утверждения» в итог «выполнена») — исполнителю «работа принята»', () => {
    const base = { number: 6, toStageName: 'Завершена', creatorId: 'cr', assigneeId: 'as' };
    expect(
      taskNotices(
        'task.stage_changed',
        { ...base, fromState: 'done', toState: 'closed', toStageOutcome: 'success' },
        'cr',
      ),
    ).toEqual([expect.objectContaining({ userId: 'as', kind: 'task.approved' })]);
  });

  it('отмена с этапа «Утверждение» — тоже исполнителю и соисполнителям', () => {
    const n = taskNotices(
      'task.stage_changed',
      {
        number: 8,
        toStageName: 'Отменена',
        creatorId: 'cr',
        assigneeId: 'as',
        coexecutorIds: ['co'],
        fromState: 'done',
        toState: 'closed',
        toStageOutcome: 'cancelled',
      },
      'cr',
    );
    expect(n.map((x) => [x.userId, x.kind])).toEqual([
      ['as', 'task.cancelled'],
      ['co', 'task.cancelled'],
    ]);
  });

  it('итог → итог и фоновый перенос публикации — без уведомлений', () => {
    const base = { number: 9, toStageName: 'Завершена', creatorId: 'cr', assigneeId: 'as' };
    expect(
      taskNotices(
        'task.stage_changed',
        { ...base, fromState: 'closed', toState: 'closed', toStageOutcome: 'success' },
        'cr',
      ),
    ).toEqual([]);
    expect(
      taskNotices(
        'task.stage_changed',
        {
          ...base,
          fromState: 'active',
          toState: 'closed',
          toStageOutcome: 'success',
          cause: 'workflow_migration',
        },
        null,
      ),
    ).toEqual([]);
  });

  it('просрочка — обоим без дублей; наблюдатель в составе — без уведомления', () => {
    expect(
      taskNotices('task.overdue', { number: 2, title: 'T', assigneeId: 'x', creatorId: 'x' }, null),
    ).toHaveLength(1);
    expect(
      taskNotices(
        'task.participants_changed',
        { number: 2, title: 'T', added: [{ userId: 'o', role: 'observer' }] },
        'me',
      ),
    ).toEqual([]);
  });
});
