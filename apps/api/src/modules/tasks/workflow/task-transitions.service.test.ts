import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { TaskTransitionsService } from './task-transitions.service.js';

const TX = { tx: true };
const USER = { id: 'bob', displayName: 'Боб', permissions: [] } as unknown as AuthUser;

function makeService(
  deps: Partial<
    Record<'txRunner' | 'query' | 'placements' | 'taskService' | 'engine' | 'cells', unknown>
  >,
) {
  return new TaskTransitionsService(
    (deps.txRunner ?? {}) as never,
    (deps.query ?? {}) as never,
    (deps.placements ?? {}) as never,
    (deps.taskService ?? {}) as never,
    (deps.engine ?? {}) as never,
    (deps.cells ?? {}) as never,
  );
}

describe('TaskTransitionsService — сценарии API кнопок маршрута (#428)', () => {
  it('executeFor: видимость → личные маршруты → переход и НОВЫЕ кнопки в одной tx → строка', async () => {
    const order: string[] = [];
    const row = { id: 't1', creatorId: 'alice', assigneeId: 'bob', participants: [] };
    const query = {
      visibleRow: vi.fn(async () => (order.push('visible'), row)),
    };
    const placements = { prepare: vi.fn(async () => void order.push('prepare')) };
    const txRunner = {
      run: vi.fn(async (fn: (tx: unknown) => unknown) => (order.push('tx'), fn(TX))),
    };
    const taskService = { listItem: vi.fn(async () => (order.push('item'), { id: 't1' })) };
    const engine = {
      execute: vi.fn(async () => (order.push('execute'), { id: 'stage' })),
      available: vi.fn(async () => (order.push('available'), [{ id: 'next' }])),
    };
    const service = makeService({ txRunner, placements, query, taskService, engine });
    const result = await service.executeFor(USER, 't1', 'tr1', {
      override: true,
      reason: 'срочно',
    });
    expect(result).toEqual({ task: { id: 't1' }, transitions: [{ id: 'next' }] });
    expect(order).toEqual(['visible', 'prepare', 'tx', 'execute', 'available', 'item']);
    expect(placements.prepare).toHaveBeenCalledWith(['alice', 'bob']);
    expect(engine.execute).toHaveBeenCalledWith(
      TX,
      't1',
      'task',
      USER,
      { transitionId: 'tr1' },
      { override: true, reason: 'срочно' },
    );
    expect(engine.available).toHaveBeenCalledWith(TX, 't1', 'task', USER);
    expect(taskService.listItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'bob' }), 't1');
  });

  it('listFor: чужая задача — 404 до транзакции', async () => {
    const txRunner = { run: vi.fn() };
    const service = makeService({
      txRunner,
      query: { visibleRow: vi.fn().mockRejectedValue(new Error('404')) },
    });
    await expect(service.listFor(USER, 't1')).rejects.toThrow('404');
    expect(txRunner.run).not.toHaveBeenCalled();
  });
});

describe('TaskTransitionsService — окно перехода (#380)', () => {
  it('новый ответственный из формы: активность и личные маршруты — до транзакции', async () => {
    const row = {
      id: 't1',
      creatorId: 'alice',
      assigneeId: 'bob',
      participants: [{ userId: 'carol', role: 'coexecutor' }],
    };
    const query = { visibleRow: vi.fn(async () => row) };
    const placements = { prepare: vi.fn(async () => void 0) };
    const taskService = {
      assertActiveUsers: vi.fn(async () => void 0),
      listItem: vi.fn(async () => ({ id: 't1' })),
    };
    const engine = {
      execute: vi.fn(async () => ({ stage: { id: 's' }, recordId: 'r' })),
      available: vi.fn(async () => []),
    };
    const txRunner = { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) };
    const service = makeService({ txRunner, placements, query, taskService, engine });
    await service.executeFor(USER, 't1', 'tr1', {
      form: { fields: { assigneeId: 'dave' } },
    });
    expect(taskService.assertActiveUsers).toHaveBeenCalledWith(['dave']);
    expect(placements.prepare).toHaveBeenCalledWith(['alice', 'dave', 'carol']);
    expect(engine.execute).toHaveBeenCalledWith(
      TX,
      't1',
      'task',
      USER,
      { transitionId: 'tr1' },
      { form: { fields: { assigneeId: 'dave' } } },
    );
  });
});
