import { describe, expect, it, vi } from 'vitest';

import {
  LetterFormulaNodeSourceHandler,
  LetterFormulaProjectSourceHandler,
  LetterFormulaTaskSourceHandler,
} from './letter-formula-source.handler.js';

/**
 * #632 (Р4/Р8): формулы ПИСЕМ с источником `ref_field` (ссылка на задачу,
 * проект, папку) пересчитываются по событиям их владельцев. Пишутся только
 * письма (I3), глубина — от ячейки-источника (аккумулятор recalc_depth).
 */

const LETTER = '63200000-0000-4000-8000-000000000601';
const TASK = '63200000-0000-4000-8000-000000000602';
const PROJECT = '63200000-0000-4000-8000-000000000603';
const NODE = '63200000-0000-4000-8000-000000000604';
const FIELD = '63200000-0000-4000-8000-000000000605';

const logger = () => ({ setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

function event(type: string, payload: Record<string, unknown>, actorId: string | null = null) {
  return { id: 'evt-1', type, actorId, payload, createdAt: '2026-11-06T00:00:00.000Z' };
}

function setup() {
  const formulas = { recalcCells: vi.fn(async () => void 0) };
  const cells = {
    numberByDefinitionId: vi.fn(async () => 4),
    depthOf: vi.fn(async () => 1),
    dependentCellsByValues: vi.fn(async () => [
      { cellId: 'c-letter', hostKind: 'letter', hostId: LETTER, fieldId: FIELD },
      { cellId: 'c-letter-2', hostKind: 'letter', hostId: LETTER, fieldId: 'f2' },
      { cellId: 'c-task', hostKind: 'task', hostId: TASK, fieldId: FIELD },
      { cellId: 'c-node', hostKind: 'node', hostId: NODE, fieldId: FIELD },
    ]),
    dependentCellsByDepKey: vi.fn(async () => []),
  };
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({}) };
  return { formulas, cells, txRunner };
}

describe('LetterFormulaTaskSourceHandler: task.updated (#632, Р4)', () => {
  it('значение задачи — пересчёт писем-потребителей, чужие хосты не пишутся', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new LetterFormulaTaskSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('task.updated', {
        taskId: TASK,
        number: 7,
        audience: [],
        fields: [`cf.${FIELD}`],
        customFieldChanges: [{ fieldId: FIELD, from: 1, to: 2 }],
      }),
    );
    expect(cells.dependentCellsByValues).toHaveBeenCalledWith('task', TASK, [4], {});
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, LETTER, [], 2);
  });

  it('правка без значений атрибутов — пересчёта нет', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new LetterFormulaTaskSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('task.updated', { taskId: TASK, number: 7, audience: [], fields: ['title'] }),
    );
    expect(cells.dependentCellsByValues).not.toHaveBeenCalled();
    expect(formulas.recalcCells).not.toHaveBeenCalled();
  });
});

describe('LetterFormulaProjectSourceHandler: project.updated (#632, Р4)', () => {
  it('значение проекта — пересчёт писем со ссылкой на проект', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new LetterFormulaProjectSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(
      event('project.updated', { projectId: PROJECT, fields: [`cf.${FIELD}`, 'name'] }),
    );
    expect(cells.dependentCellsByValues).toHaveBeenCalledWith('project', PROJECT, [4], {});
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, LETTER, [], 2);
  });

  it('без ключей cf. — пересчёта нет', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new LetterFormulaProjectSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    );
    await handler.handle(event('project.updated', { projectId: PROJECT, fields: ['status'] }));
    expect(cells.dependentCellsByValues).not.toHaveBeenCalled();
    expect(formulas.recalcCells).not.toHaveBeenCalled();
  });
});

describe('LetterFormulaNodeSourceHandler: project.node_updated (#632, Р4)', () => {
  it('значение папки — пересчёт писем со ссылкой на папку', async () => {
    const { formulas, cells, txRunner } = setup();
    const handler = new LetterFormulaNodeSourceHandler(
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
    expect(cells.dependentCellsByValues).toHaveBeenCalledWith('node', NODE, [4], {});
    expect(formulas.recalcCells).toHaveBeenCalledTimes(1);
    expect(formulas.recalcCells).toHaveBeenCalledWith({}, null, LETTER, [], 2);
  });
});
