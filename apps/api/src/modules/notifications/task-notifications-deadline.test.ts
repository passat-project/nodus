import { describe, expect, it } from 'vitest';

import { taskNotices } from './task-notifications.js';

/** Смена срока задачи (#996): адресаты, вид и текст уведомления. */
describe('taskNotices: смена срока (#996)', () => {
  it('постановщику, ответственному и соисполнителям, кроме изменившего', () => {
    const payload = {
      number: 5,
      title: 'Переезд офиса',
      fields: ['deadline'],
      deadlineChanged: true,
      // 17:00 в Минске = 14:00 UTC: дата и время без сдвига.
      deadline: '2026-12-05T14:00:00.000Z',
      creatorId: 'cr',
      assigneeId: 'as',
      coexecutorIds: ['co'],
      audience: ['cr', 'as', 'co', 'ob'],
    };
    expect(taskNotices('task.updated', payload, 'cr')).toEqual([
      {
        userId: 'as',
        kind: 'task.deadline_changed',
        preview: 'ПП-5 · Переезд офиса · до 5 декабря, 17:00',
      },
      {
        userId: 'co',
        kind: 'task.deadline_changed',
        preview: 'ПП-5 · Переезд офиса · до 5 декабря, 17:00',
      },
    ]);
    // Изменил ответственный — постановщику и соисполнителю.
    expect(taskNotices('task.updated', payload, 'as')).toMatchObject([
      { userId: 'cr', kind: 'task.deadline_changed' },
      { userId: 'co', kind: 'task.deadline_changed' },
    ]);
  });

  it('снятие срока — «срок снят»; без маркера фактической смены — тишина', () => {
    const base = {
      number: 5,
      title: 'Переезд офиса',
      fields: ['deadline'],
      deadlineChanged: true,
      deadline: null,
      creatorId: 'cr',
      assigneeId: 'as',
    };
    expect(taskNotices('task.updated', base, 'cr')).toEqual([
      { userId: 'as', kind: 'task.deadline_changed', preview: 'ПП-5 · Переезд офиса · срок снят' },
    ]);
    // «Просто сохранил» карточку: deadline пришёл, фактической смены нет.
    expect(taskNotices('task.updated', { ...base, deadlineChanged: false }, 'cr')).toEqual([]);
    expect(taskNotices('task.updated', { ...base, deadlineChanged: undefined }, 'cr')).toEqual([]);
    // Правка других полей.
    expect(
      taskNotices('task.updated', { ...base, fields: ['title'], deadlineChanged: false }, 'cr'),
    ).toEqual([]);
  });
});
