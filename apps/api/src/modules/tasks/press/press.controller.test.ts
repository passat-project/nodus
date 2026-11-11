import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { TaskPressController } from './press.controller.js';

const USER = { id: 'u1', permissions: [] } as never;
const TASK = { id: 't1', press: null };
const RESULT = { press: null, task: TASK, transitions: [] };

function setup() {
  const press = {
    submit: vi.fn(async () => null),
    withdraw: vi.fn(async () => null),
    latestView: vi.fn(async () => null),
  };
  const admin = {
    returnEntries: vi.fn(async () => null),
    excludeEntries: vi.fn(async () => null),
  };
  const query = {
    visibleRow: vi.fn(async () => ({
      id: 't1',
      creatorId: 'creator',
      assigneeId: 'assignee',
      participants: [],
    })),
    detail: vi.fn(async () => TASK),
  };
  const transitions = { listFor: vi.fn(async () => []) };
  const controller = new TaskPressController(
    press as never,
    admin as never,
    query as never,
    transitions as never,
  );
  return { controller, press, admin, query, transitions };
}

describe('TaskPressController (#434)', () => {
  it('submit/withdraw проверяют видимость и отдают карточку с кнопками', async () => {
    const { controller, press, query, transitions } = setup();
    await expect(controller.submit(USER, 't1', {})).resolves.toEqual(RESULT);
    expect(query.visibleRow).toHaveBeenCalledWith(USER, 't1');
    expect(press.submit).toHaveBeenCalledWith(USER, 't1', {});

    await expect(controller.withdraw(USER, 't1')).resolves.toEqual(RESULT);
    expect(press.withdraw).toHaveBeenCalledWith(USER, 't1');
    expect(transitions.listFor).toHaveBeenCalledWith(USER, 't1');
  });

  it('return/exclude идут в админский сервис с причиной', async () => {
    const { controller, admin } = setup();
    const body = { userIds: ['u2'], reason: 'Причина' };
    await expect(controller.returnSelected(USER, 't1', body)).resolves.toEqual(RESULT);
    expect(admin.returnEntries).toHaveBeenCalledWith(USER, 't1', body);
    await expect(controller.excludeSelected(USER, 't1', body)).resolves.toEqual(RESULT);
    expect(admin.excludeEntries).toHaveBeenCalledWith(USER, 't1', body);
  });

  it('внешний нажавший после кворума получает 200 с итогом, а не 404 (#434)', async () => {
    const { controller, press, query } = setup();
    const completed = { id: 'r1', completed: true } as never;
    press.latestView.mockResolvedValueOnce(completed);
    query.detail
      .mockResolvedValueOnce(TASK)
      .mockRejectedValueOnce(new DomainException(ErrorCode.NOT_FOUND, 'Task not found'));

    await expect(controller.submit(USER, 't1', {})).resolves.toEqual({
      press: completed,
      task: { ...TASK, press: completed },
      transitions: [],
    });
    expect(press.latestView).toHaveBeenCalledWith('u1', 't1');
  });
});
