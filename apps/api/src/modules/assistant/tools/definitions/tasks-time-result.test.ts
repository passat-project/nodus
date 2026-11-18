import { describe, expect, it, vi } from 'vitest';
import type {
  ExecuteTransitionResult,
  TaskListItem,
  TaskResult,
  TimeEntry,
} from '@nodus/contracts';

import type { ToolContext } from '../tool-definition.js';
import {
  tasksAddResultTool,
  tasksAddSubtaskTool,
  tasksLogTimeTool,
  tasksPressActionTool,
} from './tasks-time-result.tools.js';

/** #928: итог, подзадача, трудозатраты, нажатие действия маршрута. */

const T = '11111111-1111-4111-8111-111111111111';
const SUB = '22222222-2222-4222-8222-222222222222';
const U = '33333333-3333-4333-8333-333333333333';
const ACTION = '44444444-4444-4444-8444-444444444444';
const ENTRY = '55555555-5555-4555-8555-555555555555';

const ctx: ToolContext = {
  authorization: 'Bearer t',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: vi.fn(async (path: string) => {
    if (path === `/tasks/${T}`) return { id: T, number: 1042, title: 'Проверить смету' };
    if (path === `/directory/users/${U}`) return { id: U, displayName: 'Петров Пётр' };
    if (path === `/tasks/${T}/actions`)
      return [{ id: ACTION, name: 'Согласовать', blockedBy: [], form: null }];
    return null;
  }),
};

describe('итог и подзадача', () => {
  it('итог: тело, карточка и отсутствие автоотмены', async () => {
    const input = { taskId: T, text: 'Смета проверена' };
    expect(tasksAddResultTool.build!(input)).toEqual({
      method: 'POST',
      path: `/tasks/${T}/results`,
      body: { text: 'Смета проверена' },
    });
    expect(await tasksAddResultTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([{ label: 'Итог', value: 'Смета проверена' }]),
    );
    expect(tasksAddResultTool.card!.undo).toBeUndefined();
    expect(tasksAddResultTool.card!.consequences).toContain('Автоматической отмены нет');
  });

  it('подзадача: карточка с исполнителем, undo удаляет созданную подзадачу', async () => {
    const input = { taskId: T, title: 'Собрать данные', assigneeId: U };
    expect(tasksAddSubtaskTool.build!(input)).toEqual({
      method: 'POST',
      path: `/tasks/${T}/subtasks`,
      body: { title: 'Собрать данные', assigneeId: U },
    });
    const fields = await tasksAddSubtaskTool.card!.fields(input, ctx);
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: 'Родительская задача', value: '№1042 «Проверить смету»' },
        { label: 'Исполнитель', value: 'Петров Пётр' },
      ]),
    );
    expect(tasksAddSubtaskTool.card!.undo!(input, { id: SUB })).toEqual({
      method: 'DELETE',
      path: `/tasks/${SUB}`,
    });
  });
});

describe('трудозатраты', () => {
  it('время: человеческий формат, дата и undo удаляет запись', async () => {
    const input = { taskId: T, minutes: 135, date: '2026-11-18', comment: 'Проверка сметы' };
    expect(tasksLogTimeTool.build!(input)).toEqual({
      method: 'POST',
      path: `/tasks/${T}/time-entries`,
      body: { minutes: 135, date: '2026-11-18', comment: 'Проверка сметы' },
    });
    const fields = await tasksLogTimeTool.card!.fields(input, ctx);
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: 'Время', value: '2 ч 15 мин' },
        { label: 'Дата работы', value: '18 ноя 2026' },
      ]),
    );
    expect(tasksLogTimeTool.card!.undo!(input, { id: ENTRY })).toEqual({
      method: 'DELETE',
      path: `/tasks/time-entries/${ENTRY}`,
    });
  });
});

describe('действие маршрута', () => {
  it('карточка называет действие, проекция честно говорит о статусе', async () => {
    const input = { taskId: T, actionId: ACTION };
    expect(tasksPressActionTool.build!(input)).toEqual({
      method: 'POST',
      path: `/tasks/${T}/actions/${ACTION}/press`,
      body: {},
    });
    const summary = await tasksPressActionTool.card!.summary(input, ctx);
    expect(summary).toContain('Согласовать');
    expect(summary).toContain('№1042 «Проверить смету»');
    const result = {
      task: { id: T, number: 1042, title: 'Проверить смету' },
      transitions: [],
    } as unknown as ExecuteTransitionResult;
    expect(tasksPressActionTool.project!(result, input).text).toContain('статус не изменился');
    expect(tasksPressActionTool.card!.undo).toBeUndefined();
  });
});

describe('проекции результатов API', () => {
  it('итог и трудозатраты читают контракт', () => {
    const result = {
      id: 'r1',
      text: 'Готово',
      messageIds: [],
      author: { id: U, displayName: 'Петров' },
      createdAt: '2026-11-18T10:00:00.000Z',
    } as unknown as TaskResult;
    expect(tasksAddResultTool.project!(result, { taskId: T, text: 'Готово' }).text).toContain(
      'Готово',
    );
    const entry = {
      id: ENTRY,
      taskId: T,
      user: { id: U, displayName: 'Петров' },
      minutes: 60,
      date: '2026-11-18',
      method: 'manual',
      startedAt: null,
      endedAt: null,
      comment: null,
      createdAt: '2026-11-18T10:00:00.000Z',
    } as unknown as TimeEntry;
    expect(
      tasksLogTimeTool.project!(entry, { taskId: T, minutes: 60, date: '2026-11-18' }).text,
    ).toContain('1 ч');
    const subtask = { id: SUB, number: 1043, title: 'Собрать данные' } as unknown as TaskListItem;
    expect(
      tasksAddSubtaskTool.project!(subtask, { taskId: T, title: 'Собрать данные' }).entity,
    ).toEqual({
      href: `?cards=task:${SUB}`,
      label: 'Собрать данные',
    });
  });
});
