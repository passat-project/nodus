import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, WorkflowTransition } from '@nodus/contracts';

import { TaskTransitionsService } from './task-transitions.service.js';

const TX = { tx: true };
const USER = { id: 'bob', displayName: 'Боб', permissions: [] } as unknown as AuthUser;

function logger() {
  return { setContext: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() };
}

function makeService(
  deps: Partial<
    Record<
      | 'txRunner'
      | 'query'
      | 'placements'
      | 'taskService'
      | 'engine'
      | 'cells'
      | 'press'
      | 'projects',
      unknown
    >
  >,
  log = logger(),
) {
  return new TaskTransitionsService(
    (deps.txRunner ?? { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) }) as never,
    (deps.query ?? { visibleRow: vi.fn(async () => ({ stageId: 's1' })) }) as never,
    (deps.placements ?? {}) as never,
    (deps.taskService ?? {}) as never,
    (deps.engine ?? {}) as never,
    (deps.cells ?? {}) as never,
    (deps.projects ?? { lockProject: vi.fn() }) as never,
    log as never,
    (deps.press ?? {
      ensureForStage: vi.fn(async () => ({
        transitionId: null,
        roundStarted: false,
        emptySources: false,
      })),
    }) as never,
  );
}

/** Кнопка с формульным слотом: ключ → AST (движок в тесте не считает). */
function transition(formulas: Record<string, unknown>): WorkflowTransition {
  return {
    id: 'tr1',
    form: {
      enabled: true,
      sections: [{ kind: 'fields', fields: Object.keys(formulas), formulas }],
    },
  } as unknown as WorkflowTransition;
}

/** Стенд listFor: одна кнопка, evaluate отдаёт заранее заданные ответы. */
function listStand(answers: Record<string, unknown>) {
  const log = logger();
  const cells = {
    evaluate: vi.fn(async (_kind: string, _id: string, ast: unknown) => answers[String(ast)]),
  };
  const service = makeService(
    {
      query: { visibleRow: vi.fn(async () => ({ id: 't1' })) },
      txRunner: { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) },
      engine: {
        available: vi.fn(async () => [transition({ plannedMinutes: 'a', assignee: 'b' })]),
      },
      cells,
    },
    log,
  );
  return { service, log, cells };
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

  it('executeFor: пустые источники коллективной кнопки — 409, движок не работает (#434)', async () => {
    const row = { id: 't1', creatorId: 'alice', assigneeId: 'bob', participants: [] };
    const query = { visibleRow: vi.fn(async () => row) };
    const placements = { prepare: vi.fn(async () => void 0) };
    const engine = { execute: vi.fn(), available: vi.fn() };
    const press = {
      ensureForStage: vi.fn(async () => ({
        transitionId: 'tr1',
        roundStarted: false,
        emptySources: true,
      })),
    };
    const service = makeService({ query, placements, engine, press });

    await expect(service.executeFor(USER, 't1', 'tr1', {})).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(engine.execute).not.toHaveBeenCalled();
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

describe('TaskTransitionsService — префилл формульных слотов окна (#632, Р12)', () => {
  it('значения подставляются; 0 минут не проходит грамматику слота (A8-5)', async () => {
    const { service, log } = listStand({
      a: { value: 0, error: null },
      b: { value: '30000000-0000-4000-8000-000000000001', error: null },
    });
    const [only] = await service.listFor(USER, 't1');
    expect(only?.formPrefill).toEqual({ assignee: '30000000-0000-4000-8000-000000000001' });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'plannedMinutes' }),
      expect.any(String),
    );
  });

  it('валидное плановое время уходит в префилл', async () => {
    const { service } = listStand({
      a: { value: 5000, error: null },
      b: { value: null, error: null },
    });
    const [only] = await service.listFor(USER, 't1');
    expect(only?.formPrefill).toEqual({ plannedMinutes: 5000 });
  });

  it('ошибка расчёта: слот пуст, переход не блокируется, ошибка в лог (A8-6)', async () => {
    const { service, log } = listStand({
      a: { value: null, error: { code: 'type_mismatch', message: 'не тот тип' } },
      b: { value: null, error: null },
    });
    const [only] = await service.listFor(USER, 't1');
    expect(only?.formPrefill).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'plannedMinutes', code: 'type_mismatch' }),
      expect.any(String),
    );
  });
});
