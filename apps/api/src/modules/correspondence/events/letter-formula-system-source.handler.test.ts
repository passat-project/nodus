import { describe, expect, it, vi } from 'vitest';

import {
  LetterFormulaAssignedSourceHandler,
  LetterFormulaDeletedSourceHandler,
  LetterFormulaNodeDeletedSourceHandler,
  LetterFormulaStageSourceHandler,
  LetterFormulaTaskSystemRunner,
} from './letter-formula-system-source.handler.js';

/** Письма, зависящие от записи-источника (#632, Р4): системные поля и
 *  значения по префиксу dep-ключа — удалённый источник не оставляет
 *  протухших ячеек; чужие хосты отфильтрованы; пустая выборка — тишина. */

const TASK = '21000000-0000-4000-8000-000000000051';
const NODE = '21000000-0000-4000-8000-000000000052';
const LETTER = '21000000-0000-4000-8000-000000000053';
const PROJECT = '21000000-0000-4000-8000-000000000054';

const logger = () => ({ setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

function event(type: string, payload: Record<string, unknown>, actorId: string | null = null) {
  return { id: 'evt-1', type, actorId, payload, createdAt: '2026-11-07T00:00:00.000Z' };
}

function setup(over: { systemRefs?: string[]; valueRefs?: string[] } = {}) {
  const formulas = { recalcCells: vi.fn(async () => void 0) };
  const cells = {
    dependentCellsByDepKey: vi.fn(async () =>
      (over.systemRefs ?? ['letter']).map((hostKind) => ({ hostKind, hostId: LETTER })),
    ),
    dependentCellsByDepPrefix: vi.fn(async () =>
      (over.valueRefs ?? []).map((hostKind) => ({ hostKind, hostId: LETTER })),
    ),
  };
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({}) };
  const runner = new LetterFormulaTaskSystemRunner(
    txRunner as never,
    formulas as never,
    cells as never,
    logger() as never,
  );
  return {
    formulas,
    cells,
    stage: new LetterFormulaStageSourceHandler(runner),
    assigned: new LetterFormulaAssignedSourceHandler(runner),
    deleted: new LetterFormulaDeletedSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    ),
    nodeDeleted: new LetterFormulaNodeDeletedSourceHandler(
      txRunner as never,
      formulas as never,
      cells as never,
      logger() as never,
    ),
  };
}

describe('формулы писем по системным полям задачи (#632, Р4)', () => {
  it('смена стадии/ответственного: письма-потребители пересчитаны, чужие хосты отфильтрованы', async () => {
    const d = setup({ systemRefs: ['letter', 'task', 'project'] });
    await d.stage.handle(
      event('task.stage_changed', { taskId: TASK, number: 12, audience: [] }, 'user-1'),
    );
    await d.assigned.handle(event('task.assigned', { taskId: TASK, number: 12, audience: [] }));
    // Оба события нашли ОДНО письмо (дедупликация хостов) — по одному вызову.
    expect(d.formulas.recalcCells).toHaveBeenCalledTimes(2);
    expect(d.formulas.recalcCells).toHaveBeenCalledWith({}, 'user-1', LETTER, [], 1);
    expect(d.cells.dependentCellsByDepPrefix).not.toHaveBeenCalled();
  });

  it('битый payload и пустая выборка — тишина', async () => {
    const d = setup({ systemRefs: [] });
    await d.stage.handle(
      event('task.stage_changed', { taskId: 'не-uuid', number: 12, audience: [] }),
    );
    expect(d.formulas.recalcCells).not.toHaveBeenCalled();
    await d.assigned.handle(event('task.assigned', { taskId: TASK, number: 12, audience: [] }));
    expect(d.formulas.recalcCells).not.toHaveBeenCalled();
  });
});

describe('формулы писем при смерти источника (#632, Р4)', () => {
  it('удаление задачи: системный ключ И значения по префиксу, уникальные письма', async () => {
    const d = setup({ systemRefs: ['letter'], valueRefs: ['letter'] });
    await d.deleted.handle(
      event(
        'task.deleted',
        { taskId: TASK, number: 12, audience: [], parentId: null, projectId: null, nodeId: null },
        'u',
      ),
    );
    expect(d.cells.dependentCellsByDepPrefix).toHaveBeenCalledWith(`v:task:${TASK}:`, {});
    // Дедупликация: письмо найдено по обоим ключам — пересчёт один.
    expect(d.formulas.recalcCells).toHaveBeenCalledTimes(1);
  });

  it('удаление папки: письма по системному ключу и префиксу значений узла', async () => {
    const d = setup({ systemRefs: [], valueRefs: ['letter'] });
    await d.nodeDeleted.handle(
      event('project.node_deleted', { nodeId: NODE, projectId: PROJECT, parentId: null }),
    );
    expect(d.cells.dependentCellsByDepKey).toHaveBeenCalledWith(`system:node:${NODE}`, {});
    expect(d.cells.dependentCellsByDepPrefix).toHaveBeenCalledWith(`v:node:${NODE}:`, {});
    expect(d.formulas.recalcCells).toHaveBeenCalledWith({}, null, LETTER, [], 1);
  });

  it('пустая выборка и битый payload — тишина', async () => {
    const d = setup({ systemRefs: [], valueRefs: [] });
    await d.deleted.handle(
      event('task.deleted', {
        taskId: TASK,
        number: 12,
        audience: [],
        parentId: null,
        projectId: null,
        nodeId: null,
      }),
    );
    await d.nodeDeleted.handle(
      event('project.node_deleted', { nodeId: 'не-uuid', projectId: PROJECT, parentId: null }),
    );
    expect(d.formulas.recalcCells).not.toHaveBeenCalled();
  });
});
