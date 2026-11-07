import { describe, expect, it, vi } from 'vitest';

import {
  TaskFormulaNodeSourceHandler,
  TaskFormulaProjectSourceHandler,
  TaskFormulaTreeCreatedHandler,
  TaskFormulaTreeDeletedHandler,
  TaskFormulaTreeMovedHandler,
  TaskFormulaTreeRunner,
} from './formula-source-recalc.handler.js';

/**
 * #632 (Р4/Р8): события проектов пересчитывают формулы ТОЛЬКО задач —
 * значения и структура проекта/папок находят зависимые ячейки задач
 * (`v:project:*`, `v:node:*`, `tree:project:*`), чужие хосты не пишутся (I3).
 */

const PROJECT = '63200000-0000-4000-8000-000000000101';
const NODE = '63200000-0000-4000-8000-000000000102';
const FIELD = '63200000-0000-4000-8000-000000000103';
const TASK = '63200000-0000-4000-8000-000000000104';

const logger = () => ({ setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

function event(type: string, payload: Record<string, unknown>, actorId: string | null = null) {
  return { id: 'evt-1', type, actorId, payload, createdAt: '2026-11-06T00:00:00.000Z' };
}

function setup() {
  const formulas = { recalcCells: vi.fn(async () => void 0) };
  const cells = {
    numberByDefinitionId: vi.fn(async () => 7),
    depthOf: vi.fn(async () => 2),
    dependentCellsByValues: vi.fn(async () => [
      { cellId: 'c-task', hostKind: 'task', hostId: TASK, fieldId: FIELD },
      { cellId: 'c-task-2', hostKind: 'task', hostId: TASK, fieldId: 'f2' },
      { cellId: 'c-project', hostKind: 'project', hostId: PROJECT, fieldId: FIELD },
      { cellId: 'c-letter', hostKind: 'letter', hostId: 'l1', fieldId: FIELD },
    ]),
    dependentCellsByDepKey: vi.fn(async () => [
      { cellId: 'c-task', hostKind: 'task', hostId: TASK, fieldId: FIELD },
      { cellId: 'c-node', hostKind: 'node', hostId: NODE, fieldId: FIELD },
    ]),
  };
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({}) };
  return { formulas, cells, txRunner };
}

describe('TaskFormulaProjectSourceHandler: project.updated (#632, Р4)', () => {
  it('значения проекта — пересчёт только задач, глубина источника + 1', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new TaskFormulaProjectSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('project.updated', { projectId: PROJECT, fields: [`cf.${FIELD}`, 'name'] }),
    );
    expect(cells.numberByDefinitionId).toHaveBeenCalledWith(FIELD, {});
    expect(cells.dependentCellsByValues).toHaveBeenCalledWith('project', PROJECT, [7], {});
    // Чужие хосты (проект, письмо) не пересчитываются: у них свой владелец (I3).
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, TASK, [], 3);
  });

  it('системное поле проекта — пересчёт по system-ключу; невалидный payload молчит', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new TaskFormulaProjectSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(event('project.updated', { projectId: PROJECT, fields: ['name'] }));
    // Значения атрибутов не менялись — работает только системный ключ (Р4).
    expect(cells.dependentCellsByValues).not.toHaveBeenCalled();
    expect(cells.dependentCellsByDepKey).toHaveBeenCalledWith(`system:project:${PROJECT}`, {});
    cells.dependentCellsByDepKey.mockClear();
    formulas.recalcCells.mockClear();
    await handler.handle(event('project.updated', { projectId: 'не-uuid', fields: [] }));
    expect(cells.dependentCellsByDepKey).not.toHaveBeenCalled();
    expect(formulas.recalcCells).not.toHaveBeenCalled();
  });
});

describe('TaskFormulaNodeSourceHandler: project.node_updated (#632, Р4)', () => {
  it('значения папки — пересчёт зависимых задач', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new TaskFormulaNodeSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('project.node_updated', {
        projectId: PROJECT,
        nodeId: NODE,
        fields: [`cf.${FIELD}`],
      }),
    );
    expect(cells.dependentCellsByValues).toHaveBeenCalledWith('node', NODE, [7], {});
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, TASK, [], 3);
  });
});

describe('TaskFormulaTreeRunner: структура проекта (#632, Р4)', () => {
  it('перенос папки — пересчёт по ключу дерева с глубиной 1', async () => {
    const { formulas, cells, txRunner } = setup();
    const runner = new TaskFormulaTreeRunner(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    const handler = new TaskFormulaTreeMovedHandler(runner);
    await handler.handle(
      event('project.node_moved', {
        projectId: PROJECT,
        nodeId: NODE,
        parentId: null,
        previousParentId: null,
      }),
    );
    expect(cells.dependentCellsByDepKey).toHaveBeenCalledWith(`tree:project:${PROJECT}`, {});
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, TASK, [], 1);
  });

  it('удаление папки — тот же ключ дерева', async () => {
    const { formulas, cells, txRunner } = setup();
    const runner = new TaskFormulaTreeRunner(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    const handler = new TaskFormulaTreeDeletedHandler(runner);
    await handler.handle(
      event('project.node_deleted', { projectId: PROJECT, nodeId: NODE, parentId: null }),
    );
    expect(cells.dependentCellsByDepKey).toHaveBeenCalledWith(`tree:project:${PROJECT}`, {});
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, TASK, [], 1);
  });

  it('создание папки меняет выборку папок проекта — задачи пересчитываются', async () => {
    const { formulas, cells, txRunner } = setup();
    const runner = new TaskFormulaTreeRunner(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    const handler = new TaskFormulaTreeCreatedHandler(runner);
    await handler.handle(
      event('project.node_created', {
        projectId: PROJECT,
        nodeId: NODE,
        parentId: null,
        kindId: '63200000-0000-4000-8000-000000000105',
        name: 'Здание 1',
      }),
    );
    expect(cells.dependentCellsByDepKey).toHaveBeenCalledWith(`tree:project:${PROJECT}`, {});
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, TASK, [], 1);
  });

  it('payload без projectId — пересчёта нет', async () => {
    const { formulas, cells, txRunner } = setup();
    const runner = new TaskFormulaTreeRunner(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await new TaskFormulaTreeMovedHandler(runner).handle(event('project.node_moved', {}));
    expect(cells.dependentCellsByDepKey).not.toHaveBeenCalled();
    expect(formulas.recalcCells).not.toHaveBeenCalled();
  });
});
