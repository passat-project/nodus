import { describe, expect, it, vi } from 'vitest';

import {
  TaskFormulaDefinitionHandler,
  TaskFormulaRecalcHandler,
} from './formula-recalc.handler.js';

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
    numberByDefinitionId: vi.fn(async (): Promise<number | null> => 7),
    depthOf: vi.fn(async () => 2),
    dependentCellsByDepKey: vi.fn(async (key: string) => {
      const parentId = key.slice('subtasks:task:'.length);
      return [{ cellId: `c-${parentId}`, hostKind: 'task', hostId: parentId, fieldId: FIELD }];
    }),
    dependentCellsByDepPrefix: vi.fn(
      async (): Promise<{ hostKind: string; hostId: string }[]> => [],
    ),
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

describe('TaskFormulaRecalcHandler: свежесть и смена проекта (security #632)', () => {
  it('formulaWrite-каскад не добавляет актёра; ручная правка — добавляет', async () => {
    const own = setup();
    const handler = new TaskFormulaRecalcHandler(
      own.txRunner as never,
      own.formulas as never,
      own.cells as never,
      logger() as never,
    );
    await handler.handle(
      event({ formulaWrite: true, customFieldChanges: [{ fieldId: FIELD, from: null, to: 1 }] }),
    );
    expect(own.formulas.recalcCells).toHaveBeenCalledWith({}, null, TASK, [7], 3, {
      includeActorForOwnHost: false,
    });
    own.formulas.recalcCells.mockClear();
    await handler.handle(event({ customFieldChanges: [{ fieldId: FIELD, from: null, to: 1 }] }));
    expect(own.formulas.recalcCells).toHaveBeenCalledWith({}, null, TASK, [7], 3, {
      includeActorForOwnHost: true,
    });
  });

  it('смена проекта — потребители значений задачи пересчитаны', async () => {
    const own = setup();
    own.cells.dependentCellsByDepPrefix = vi.fn(async () => [
      { cellId: 'c-foreign', hostKind: 'task', hostId: 'foreign-task', fieldId: FIELD },
      { cellId: 'c-self', hostKind: 'task', hostId: TASK, fieldId: FIELD },
    ]);
    own.cells.dependentCellsByDepKey = vi.fn(async () => []);
    const handler = new TaskFormulaRecalcHandler(
      own.txRunner as never,
      own.formulas as never,
      own.cells as never,
      logger() as never,
    );
    await handler.handle(
      event({
        projectId: '63200000-0000-4000-8000-000000000405',
        previousProjectId: '63200000-0000-4000-8000-000000000406',
      }),
    );
    expect(own.cells.dependentCellsByDepPrefix).toHaveBeenCalledWith(`v:task:${TASK}:`, {});
    expect(own.formulas.recalcCells).toHaveBeenCalledWith({}, null, 'foreign-task', [], 1);
  });
});

describe('TaskFormulaDefinitionHandler (#632, Р13)', () => {
  const DEF_EVENT = (payload: Record<string, unknown>) => ({
    id: 'evt-2',
    type: 'custom_field.definition_changed',
    actorId: 'user-9',
    payload,
    createdAt: '2026-11-07T00:00:00.000Z',
  });

  function defSetup(refs: { hostKind: string; hostId: string }[] = []) {
    const formulas = { recalcCells: vi.fn(async () => void 0) };
    const cells = {
      dependentCellsByField: vi.fn(async () => refs),
      dependentCellsByAttrNumber: vi.fn(async () => refs),
      numberByDefinitionId: vi.fn(async (): Promise<number | null> => 7),
    };
    const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({}) };
    return {
      formulas,
      cells,
      handler: new TaskFormulaDefinitionHandler(
        txRunner as never,
        formulas as never,
        cells as never,
        logger() as never,
      ),
    };
  }

  it('смена привязок — все ячейки задач атрибута; чужие поля — тишина', async () => {
    const d = defSetup([
      { hostKind: 'task', hostId: TASK },
      { hostKind: 'task', hostId: TASK },
    ]);
    await d.handler.handle(
      DEF_EVENT({ definitionId: FIELD, change: 'updated', fields: ['bindings'] }),
    );
    expect(d.formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(d.formulas.recalcCells).toHaveBeenCalledWith({}, 'user-9', TASK, [], 1);
    const quiet = defSetup([]);
    await quiet.handler.handle(
      DEF_EVENT({ definitionId: FIELD, change: 'updated', fields: ['hint'] }),
    );
    expect(quiet.formulas.recalcCells).not.toHaveBeenCalled();
  });

  it('удаление — по номеру из payload; номер не найден — тишина', async () => {
    const d = defSetup([{ hostKind: 'task', hostId: TASK }]);
    await d.handler.handle(DEF_EVENT({ definitionId: FIELD, change: 'deleted', number: 7 }));
    expect(d.cells.dependentCellsByAttrNumber).toHaveBeenCalledWith(7);
    expect(d.formulas.recalcCells).toHaveBeenCalledWith({}, 'user-9', TASK, [7], 1);
    const noNumber = defSetup([]);
    noNumber.cells.numberByDefinitionId = vi.fn(async () => null);
    await noNumber.handler.handle(DEF_EVENT({ definitionId: FIELD, change: 'deleted' }));
    expect(noNumber.formulas.recalcCells).not.toHaveBeenCalled();
  });
});
