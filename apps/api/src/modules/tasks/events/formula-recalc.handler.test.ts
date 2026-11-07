import { describe, expect, it, vi } from 'vitest';

import { TaskFormulaRecalcHandler } from './formula-recalc.handler.js';

/**
 * #632 (Р4/Р8): `task.updated` пересчитывает свои ячейки задачи (глубина —
 * от ячейки-источника) и агрегаты подзадач старого и нового родителя
 * (перепривязка — ручная правка, глубина 1).
 */

const TASK = '63200000-0000-4000-8000-000000000401';
const FIELD = '63200000-0000-4000-8000-000000000402';
const PARENT = '63200000-0000-4000-8000-000000000403';
const OLD_PARENT = '63200000-0000-4000-8000-000000000404';

const logger = () => ({ setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

function event(payload: Record<string, unknown>, actorId: string | null = null) {
  return {
    id: 'evt-1',
    type: 'task.updated',
    actorId,
    payload: { taskId: TASK, number: 5, audience: [], fields: [`cf.${FIELD}`], ...payload },
    createdAt: '2026-11-06T00:00:00.000Z',
  };
}

function setup() {
  const formulas = { recalcCells: vi.fn(async () => void 0) };
  const cells = {
    numberByDefinitionId: vi.fn(async () => 7),
    depthOf: vi.fn(async () => 2),
    dependentCellsByDepKey: vi.fn(async (key: string) => {
      const parentId = key.slice('subtasks:task:'.length);
      return [{ cellId: `c-${parentId}`, hostKind: 'task', hostId: parentId, fieldId: FIELD }];
    }),
  };
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({}) };
  return { formulas, cells, txRunner };
}

describe('TaskFormulaRecalcHandler: task.updated (#632, Р4)', () => {
  it('значение атрибута — пересчёт своих ячеек с глубиной источника + 1', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new TaskFormulaRecalcHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event({ customFieldChanges: [{ fieldId: FIELD, from: 1, to: 2 }] }, 'actor-1'),
    );
    expect(cells.depthOf).toHaveBeenCalledWith('task', TASK, FIELD, {});
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, 'actor-1', TASK, [7], 3, {
      includeActorForOwnHost: true,
    });
  });

  it('перепривязка — пересчёт обоих родителей с глубиной 1', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new TaskFormulaRecalcHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(event({ parentId: PARENT, previousParentId: OLD_PARENT }));
    expect(cells.dependentCellsByDepKey).toHaveBeenCalledWith(`subtasks:task:${PARENT}`, {});
    expect(cells.dependentCellsByDepKey).toHaveBeenCalledWith(`subtasks:task:${OLD_PARENT}`, {});
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, TASK, [], 1, {
      includeActorForOwnHost: true,
    });
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, PARENT, [], 1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, OLD_PARENT, [], 1);
  });

  it('смена узла — ищем потребителей «задачи папки» старого и нового узла', async () => {
    const { formulas, cells, txRunner } = setup();
    cells.dependentCellsByDepKey.mockImplementation(async (key: string) =>
      key.startsWith('nodetasks:') ? [] : [],
    );
    const handler = new TaskFormulaRecalcHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event({
        nodeId: '63200000-0000-4000-8000-000000000405',
        previousNodeId: '63200000-0000-4000-8000-000000000406',
      }),
    );
    expect(cells.dependentCellsByDepKey).toHaveBeenCalledWith(
      'nodetasks:node:63200000-0000-4000-8000-000000000405',
      {},
    );
    expect(cells.dependentCellsByDepKey).toHaveBeenCalledWith(
      'nodetasks:node:63200000-0000-4000-8000-000000000406',
      {},
    );
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, TASK, [], 1, {
      includeActorForOwnHost: true,
    });
  });
});
