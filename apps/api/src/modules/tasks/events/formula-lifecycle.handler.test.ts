import { describe, expect, it, vi } from 'vitest';

import {
  TaskCreatedFormulaSourceHandler,
  TaskDeletedFormulaSourceHandler,
  TaskRelationFormulaHandler,
} from './formula-lifecycle.handler.js';

/**
 * #632 (Р4/Р8): жизненный цикл задачи — связи, создание и удаление.
 * Пересчитываются только ячейки задач (I3): у удалённой задачи ячейки
 * убираются, у родителя обновляются агрегаты подзадач.
 */

const TASK = '63200000-0000-4000-8000-000000000201';
const PARENT = '63200000-0000-4000-8000-000000000202';
const FIELD = '63200000-0000-4000-8000-000000000203';

const logger = () => ({ setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

function event(type: string, payload: Record<string, unknown>, actorId: string | null = null) {
  return { id: 'evt-1', type, actorId, payload, createdAt: '2026-11-06T00:00:00.000Z' };
}

const base = { taskId: TASK, number: 12, audience: [] as string[] };

const createdPayload = {
  ...base,
  title: 'Проверить КЖ',
  creatorId: '63200000-0000-4000-8000-000000000204',
  assigneeId: '63200000-0000-4000-8000-000000000205',
  coexecutorIds: [],
  observerIds: [],
  projectId: null,
  parentId: PARENT,
  source: 'manual',
  sourceId: null,
};

function setup() {
  const formulas = { recalcCells: vi.fn(async () => void 0) };
  const cells = {
    cleanupHost: vi.fn(async () => void 0),
    dependentCellsByDepPrefix: vi.fn(async () => []),
    dependentCellsByDepKey: vi.fn(async (key: string) =>
      key.startsWith('subtasks:')
        ? [
            { cellId: 'c-parent', hostKind: 'task', hostId: PARENT, fieldId: FIELD },
            {
              cellId: 'c-node',
              hostKind: 'node',
              hostId: '63200000-0000-4000-8000-000000000206',
              fieldId: FIELD,
            },
          ]
        : [],
    ),
  };
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({}) };
  return { formulas, cells, txRunner };
}

describe('TaskRelationFormulaHandler: task.relation_changed (#632, Р4)', () => {
  it('связи сменились — пересчёт всех своих ячеек задачи (глубина 1)', async () => {
    const { formulas, txRunner } = setup();
    const handler = new TaskRelationFormulaHandler(
      txRunner as never,
      formulas as never,
      logger() as never,
    );
    await handler.handle(event('task.relation_changed', base));
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, TASK, [], 1, {
      includeActorForOwnHost: true,
    });
  });

  it('невалидный payload игнорируется', async () => {
    const { formulas, txRunner } = setup();
    const handler = new TaskRelationFormulaHandler(
      txRunner as never,
      formulas as never,
      logger() as never,
    );
    await handler.handle(event('task.relation_changed', { taskId: 'не-uuid' }));
    expect(formulas.recalcCells).not.toHaveBeenCalled();
  });
});

describe('TaskCreatedFormulaSourceHandler: task.created (#632, Р4)', () => {
  it('новая подзадача — пересчёт агрегатов родителя, чужие хосты не пишутся', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new TaskCreatedFormulaSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(event('task.created', createdPayload));
    expect(cells.dependentCellsByDepKey).toHaveBeenCalledWith(`subtasks:task:${PARENT}`, {});
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, PARENT, [], 1);
  });

  it('задача без родителя — пересчёта нет (своих ячеек у новой задачи нет)', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new TaskCreatedFormulaSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(event('task.created', { ...createdPayload, parentId: null }));
    expect(cells.dependentCellsByDepKey).not.toHaveBeenCalled();
    expect(formulas.recalcCells).not.toHaveBeenCalled();
  });
});

describe('TaskDeletedFormulaSourceHandler: task.deleted (#632, Р4)', () => {
  it('ячейки удалённой задачи убираются, агрегаты родителя пересчитываются', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new TaskDeletedFormulaSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('task.deleted', { ...base, projectId: null, nodeId: null, parentId: PARENT }),
    );
    expect(cells.cleanupHost).toHaveBeenCalledWith({}, 'task', TASK);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, PARENT, [], 1);
  });

  it('удалённая задача без родителя — только уборка своих ячеек', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new TaskDeletedFormulaSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('task.deleted', { ...base, projectId: null, nodeId: null, parentId: null }),
    );
    expect(cells.cleanupHost).toHaveBeenCalledWith({}, 'task', TASK);
    // Потребители значений/системных полей удалённой задачи ищутся всегда
    // (префикс + точный ключ), но при пустых выборках пересчёта нет.
    expect(cells.dependentCellsByDepPrefix).toHaveBeenCalledWith(`v:task:${TASK}:`, {});
    expect(cells.dependentCellsByDepKey).toHaveBeenCalledWith(`system:task:${TASK}`, {});
    expect(formulas.recalcCells).not.toHaveBeenCalled();
  });
});
