import { describe, expect, it, vi } from 'vitest';

import {
  TaskCreatedProjectFormulaHandler,
  TaskDeletedProjectFormulaHandler,
  TaskUpdatedProjectFormulaHandler,
} from './formula-task-source.handler.js';

/**
 * #632 (Р4/Р8): события задач пересчитывают формулы ПРОЕКТОВ и ПАПОК —
 * `v:task:*` (атрибут-ссылка на задачу) и состав выборки «задачи папки».
 * Задачи здесь не пишутся (I3): их ячейки пересчитывает модуль задач.
 */

const PROJECT = '63200000-0000-4000-8000-000000000501';
const OTHER_PROJECT = '63200000-0000-4000-8000-000000000502';
const NODE = '63200000-0000-4000-8000-000000000503';
const OLD_NODE = '63200000-0000-4000-8000-000000000504';
const TASK = '63200000-0000-4000-8000-000000000505';
const FIELD = '63200000-0000-4000-8000-000000000506';

const logger = () => ({ setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

function event(type: string, payload: Record<string, unknown>, actorId: string | null = null) {
  return { id: 'evt-1', type, actorId, payload, createdAt: '2026-11-06T00:00:00.000Z' };
}

const base = { taskId: TASK, number: 3, audience: [] as string[] };

const createdPayload = {
  ...base,
  title: 'Собрать комплект',
  creatorId: '63200000-0000-4000-8000-000000000507',
  assigneeId: '63200000-0000-4000-8000-000000000508',
  coexecutorIds: [],
  observerIds: [],
  projectId: PROJECT,
  parentId: null,
  source: 'manual',
  sourceId: null,
};

function setup() {
  const formulas = {
    recalcProjectCells: vi.fn(async () => void 0),
    recalcNodes: vi.fn(async () => void 0),
  };
  const nodes = {
    listByIds: vi.fn(async (ids: readonly string[]) =>
      ids.map((id) => ({ id, projectId: id === OLD_NODE ? OTHER_PROJECT : PROJECT })),
    ),
  };
  const cells = {
    numberByDefinitionId: vi.fn(async () => 9),
    depthOf: vi.fn(async () => 2),
    dependentCellsByValues: vi.fn(async () => [
      { cellId: 'c-project', hostKind: 'project', hostId: PROJECT, fieldId: FIELD },
      { cellId: 'c-node', hostKind: 'node', hostId: NODE, fieldId: FIELD },
      { cellId: 'c-task', hostKind: 'task', hostId: TASK, fieldId: FIELD },
      { cellId: 'c-letter', hostKind: 'letter', hostId: 'l1', fieldId: FIELD },
    ]),
    dependentCellsByDepKey: vi.fn(async () => []),
  };
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({}) };
  return { formulas, nodes, cells, txRunner };
}

describe('TaskUpdatedProjectFormulaHandler: task.updated (#632, Р4)', () => {
  it('значения задачи — пересчёт проектов и папок, найденных по ссылке', async () => {
    const { formulas, nodes, cells, txRunner } = setup();
    const handler = new TaskUpdatedProjectFormulaHandler(
      txRunner as never,
      formulas as never,
      nodes as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('task.updated', {
        ...base,
        fields: [`cf.${FIELD}`],
        customFieldChanges: [{ fieldId: FIELD, from: 1, to: 2 }],
      }),
    );
    expect(cells.dependentCellsByValues).toHaveBeenCalledWith('task', TASK, [9], {});
    // Проект-источник ссылки: глубина — от ячейки задачи (2 + 1).
    expect(formulas.recalcProjectCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcProjectCells).toHaveBeenCalledWith({}, null, PROJECT, [], 3);
    // Папка-источник ссылки: её проект дочитывается пачкой по узлам.
    expect(nodes.listByIds).toHaveBeenCalledWith([NODE], {});
    expect(formulas.recalcNodes).toHaveBeenCalledTimes(1);
    expect(formulas.recalcNodes).toHaveBeenCalledWith({}, null, PROJECT, [NODE], 3);
  });

  it('смена узла — пересчёт папок старого и нового проекта (глубина 1)', async () => {
    const { formulas, nodes, txRunner } = setup();
    const handler = new TaskUpdatedProjectFormulaHandler(
      txRunner as never,
      formulas as never,
      nodes as never,
      { dependentCellsByValues: vi.fn(), dependentCellsByDepKey: vi.fn(async () => []) } as never,
      logger() as never,
    );
    await handler.handle(
      event('task.updated', {
        ...base,
        fields: ['nodeId'],
        nodeId: NODE,
        previousNodeId: OLD_NODE,
      }),
    );
    expect(nodes.listByIds).toHaveBeenCalledWith([NODE, OLD_NODE], {});
    expect(formulas.recalcNodes).toHaveBeenCalledWith({}, null, PROJECT, [NODE], 1);
    expect(formulas.recalcNodes).toHaveBeenCalledWith({}, null, OTHER_PROJECT, [OLD_NODE], 1);
    expect(formulas.recalcProjectCells).not.toHaveBeenCalled();
  });

  it('правка без значений и без места — пересчёта нет', async () => {
    const { formulas, nodes, txRunner } = setup();
    const handler = new TaskUpdatedProjectFormulaHandler(
      txRunner as never,
      formulas as never,
      nodes as never,
      { dependentCellsByValues: vi.fn(), dependentCellsByDepKey: vi.fn(async () => []) } as never,
      logger() as never,
    );
    await handler.handle(event('task.updated', { ...base, fields: ['title'], title: 'Новое' }));
    expect(nodes.listByIds).not.toHaveBeenCalled();
    expect(formulas.recalcNodes).not.toHaveBeenCalled();
    expect(formulas.recalcProjectCells).not.toHaveBeenCalled();
  });
});

describe('TaskCreatedProjectFormulaHandler: task.created (#632, Р4)', () => {
  it('задача в папке — пересчёт выборки папки', async () => {
    const { formulas, txRunner } = setup();
    const handler = new TaskCreatedProjectFormulaHandler(
      txRunner as never,
      formulas as never,
      logger() as never,
    );
    await handler.handle(event('task.created', { ...createdPayload, nodeId: NODE }));
    expect(formulas.recalcNodes).toHaveBeenCalledWith({}, null, PROJECT, [NODE], 1);
    expect(formulas.recalcProjectCells).not.toHaveBeenCalled();
  });

  it('задача без папки — пересчёт формул проекта', async () => {
    const { formulas, txRunner } = setup();
    const handler = new TaskCreatedProjectFormulaHandler(
      txRunner as never,
      formulas as never,
      logger() as never,
    );
    await handler.handle(event('task.created', { ...createdPayload, nodeId: null }));
    expect(formulas.recalcProjectCells).toHaveBeenCalledWith({}, null, PROJECT, [], 1);
    expect(formulas.recalcNodes).not.toHaveBeenCalled();
  });
});

describe('TaskDeletedProjectFormulaHandler: task.deleted (#632, Р4)', () => {
  it('удаление — пересчёт папки и проекта (ячейки задачи чистит её модуль)', async () => {
    const { formulas, txRunner } = setup();
    const handler = new TaskDeletedProjectFormulaHandler(
      txRunner as never,
      formulas as never,
      logger() as never,
    );
    await handler.handle(
      event('task.deleted', { ...base, projectId: PROJECT, nodeId: NODE, parentId: null }),
    );
    expect(formulas.recalcNodes).toHaveBeenCalledWith({}, null, PROJECT, [NODE], 1);
    expect(formulas.recalcProjectCells).toHaveBeenCalledWith({}, null, PROJECT, [], 1);
  });

  it('задача вне проекта — пересчёта нет', async () => {
    const { formulas, txRunner } = setup();
    const handler = new TaskDeletedProjectFormulaHandler(
      txRunner as never,
      formulas as never,
      logger() as never,
    );
    await handler.handle(
      event('task.deleted', { ...base, projectId: null, nodeId: null, parentId: null }),
    );
    expect(formulas.recalcNodes).not.toHaveBeenCalled();
    expect(formulas.recalcProjectCells).not.toHaveBeenCalled();
  });
});
