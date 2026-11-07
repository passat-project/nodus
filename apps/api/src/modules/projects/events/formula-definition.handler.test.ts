import { describe, expect, it, vi } from 'vitest';

import { ProjectFormulaDefinitionHandler } from './formula-definition.handler.js';

/** Пересчёт проектов/папок по событиям реестра (#632, Р13): глобальное
 *  значение и удаление атрибута — массовый пересчёт партиями; смена
 *  привязок — все свои ячейки атрибута; чужие поля событий игнорируются;
 *  папке нужен её проект (без него — тихий пропуск). */

const DEF = '35560000-0000-4000-8000-000000000041';
const PROJECT = '21000000-0000-4000-8000-000000000041';
const NODE = '21000000-0000-4000-8000-000000000042';

const logger = () => ({ setContext: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });

function event(payload: Record<string, unknown>, actorId: string | null = null) {
  return {
    id: 'evt-1',
    type: 'custom_field.definition_changed',
    actorId,
    payload,
    createdAt: '2026-11-07T00:00:00.000Z',
  };
}

function setup(
  over: {
    byField?: { cellId: string; hostKind: string; hostId: string; fieldId: string }[];
    byNumber?: { cellId: string; hostKind: string; hostId: string; fieldId: string }[];
    number?: number | null;
  } = {},
) {
  const formulas = {
    recalcProjectCells: vi.fn(async () => undefined),
    recalcNodeCells: vi.fn(async () => undefined),
  };
  const cells = {
    dependentCellsByField: vi.fn(async () => over.byField ?? []),
    dependentCellsByAttrNumber: vi.fn(async () => over.byNumber ?? []),
    numberByDefinitionId: vi.fn(async () => over.number ?? null),
  };
  const nodes = {
    listByIds: vi.fn(async () => [{ id: NODE, projectId: PROJECT }]),
  };
  const txRunner = { run: (fn: (tx: unknown) => unknown) => fn({}) };
  const handler = new ProjectFormulaDefinitionHandler(
    txRunner as never,
    formulas as never,
    nodes as never,
    cells as never,
    logger() as never,
  );
  return { handler, formulas, cells, nodes };
}

describe('ProjectFormulaDefinitionHandler (#632, Р13)', () => {
  it('чужие изменения определения и битый payload — тишина', async () => {
    const d = setup();
    await d.handler.handle(event({ definitionId: DEF, change: 'updated', fields: ['hint'] }));
    await d.handler.handle(event({ definitionId: 'не-uuid', change: 'updated' }));
    expect(d.cells.dependentCellsByField).not.toHaveBeenCalled();
    expect(d.cells.dependentCellsByAttrNumber).not.toHaveBeenCalled();
  });

  it('смена привязок: свои ячейки атрибута пересчитаны, папка — через проект', async () => {
    const d = setup({
      byField: [
        { cellId: 'c1', hostKind: 'project', hostId: PROJECT, fieldId: DEF },
        { cellId: 'c2', hostKind: 'node', hostId: NODE, fieldId: DEF },
        { cellId: 'c3', hostKind: 'task', hostId: 't1', fieldId: DEF },
      ],
    });
    await d.handler.handle(
      event({ definitionId: DEF, change: 'updated', fields: ['bindings'] }, 'user-1'),
    );
    expect(d.formulas.recalcProjectCells).toHaveBeenCalledWith({}, 'user-1', PROJECT, [], 1);
    expect(d.formulas.recalcNodeCells).toHaveBeenCalledWith({}, 'user-1', PROJECT, NODE, [], 1);
    expect(d.formulas.recalcProjectCells).toHaveBeenCalledTimes(1);
    expect(d.formulas.recalcNodeCells).toHaveBeenCalledTimes(1);
  });

  it('удаление: номер из payload, потребители номера пересчитаны', async () => {
    const d = setup({
      byNumber: [{ cellId: 'c1', hostKind: 'node', hostId: NODE, fieldId: 'f1' }],
      number: 7,
    });
    await d.handler.handle(event({ definitionId: DEF, change: 'deleted', number: 7 }, 'user-2'));
    expect(d.cells.numberByDefinitionId).not.toHaveBeenCalled();
    expect(d.formulas.recalcNodeCells).toHaveBeenCalledWith({}, 'user-2', PROJECT, NODE, [7], 1);
  });

  it('номера нет или пустая выборка — без пересчёта; папка без проекта пропущена', async () => {
    const noNumber = setup({ number: null });
    await noNumber.handler.handle(event({ definitionId: DEF, change: 'deleted' }));
    expect(noNumber.cells.dependentCellsByAttrNumber).not.toHaveBeenCalled();

    const orphan = setup({
      byNumber: [{ cellId: 'c1', hostKind: 'node', hostId: 'node-without-project', fieldId: 'f1' }],
      number: 3,
    });
    await orphan.handler.handle(event({ definitionId: DEF, change: 'deleted', number: 3 }));
    expect(orphan.formulas.recalcNodeCells).not.toHaveBeenCalled();
    expect(orphan.formulas.recalcProjectCells).not.toHaveBeenCalled();
  });
});
