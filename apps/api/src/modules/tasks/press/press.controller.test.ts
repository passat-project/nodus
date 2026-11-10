import { describe, expect, it, vi } from 'vitest';

import { TaskPressController } from './press.controller.js';

const USER = { id: 'u1', permissions: [] } as never;
const TASK = { id: 't1', press: null } as never;
const RESULT = { press: null, task: TASK, transitions: [] };

function setup() {
  const press = {
    submit: vi.fn(async () => null),
    withdraw: vi.fn(async () => null),
  };
  const admin = {
    returnEntries: vi.fn(async () => null),
    excludeEntries: vi.fn(async () => null),
  };
  const query = {
    visibleRow: vi.fn(async () => ({ id: 't1' })),
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
});
