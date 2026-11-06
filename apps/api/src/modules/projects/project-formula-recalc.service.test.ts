import { describe, expect, it, vi } from 'vitest';

import { ProjectFormulaEvents } from './project-formula-events.js';
import { ProjectFormulaRecalcService } from './project-formula-recalc.service.js';

/**
 * Пересчёт формул проекта и папок (#632, Р4/Р8): поддерево переноса/удаления
 * берёт только затронутые хосты (цепочка предков меняется у потомков),
 * зависимые и свои ячейки не дублируются, сбой писателя изолирован per-cell.
 */

const PROJECT = '00000000-0000-4000-8000-000000000001';
const FIELD = '00000000-0000-4000-8000-0000000000f1';

/** Итог пересчёта ячейки (тип шире фикстуры: ошибки и циклы тоже бывают). */
interface Outcome {
  value: number | null;
  error: { code: string; message: string } | null;
  changed: boolean;
  silent: boolean;
}

function make() {
  const nodes = {
    listByProject: vi.fn<
      (projectId?: string, tx?: unknown) => Promise<{ id: string; parentId: string | null }[]>
    >(async () => [
      { id: 'root', parentId: null, order: 'a' },
      { id: 'child', parentId: 'root', order: 'a' },
      { id: 'grand', parentId: 'child', order: 'a' },
      { id: 'other', parentId: null, order: 'b' },
    ]),
  };
  const writer = { writeProject: vi.fn(async () => true), writeNode: vi.fn(async () => true) };
  const repo = {
    findById: vi.fn<(id?: string, tx?: unknown) => Promise<Record<string, unknown>>>(async () => ({
      id: PROJECT,
      managerId: 'm1',
      assistantIds: [],
    })),
  };
  const participants = {
    rowsOfProject: vi.fn<(id?: string, tx?: unknown) => Promise<{ userId: string }[]>>(
      async () => [],
    ),
  };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const events = new ProjectFormulaEvents(repo as never, participants as never, eventBus as never);
  const cells = {
    cellsForHost: vi.fn<
      (
        kind: string,
        hostId: string,
      ) => Promise<{ cellId: string; hostKind: string; hostId: string; fieldId: string }[]>
    >(async (kind, hostId) => [{ cellId: `c-${hostId}`, hostKind: kind, hostId, fieldId: FIELD }]),
    dependentCellsByValues: vi.fn<
      (
        kind: string,
        hostId: string,
      ) => Promise<{ cellId: string; hostKind: string; hostId: string; fieldId: string }[]>
    >(async (kind, hostId) => [
      { cellId: `c-${hostId}`, hostKind: kind, hostId, fieldId: FIELD },
      { cellId: 'c-other', hostKind: 'node', hostId: 'other', fieldId: FIELD },
    ]),
    recalc: vi.fn<(tx?: unknown, ref?: unknown, depth?: number) => Promise<Outcome>>(async () => ({
      value: 7,
      error: null,
      changed: true,
      silent: false,
    })),
  };
  const logger = { setContext: vi.fn(), debug: vi.fn() };
  const service = new ProjectFormulaRecalcService(
    nodes as never,
    writer as never,
    events,
    cells as never,
    logger as never,
  );
  return { service, nodes, writer, eventBus, cells, logger };
}

describe('ProjectFormulaRecalcService (#632, Р4/Р8)', () => {
  it('пересчёт поддерева: только затронутые папки (потомки и корень)', async () => {
    const { service, cells, writer } = make();
    await service.recalcStructure({} as never, null, PROJECT, ['root'], 1);
    const hosts = cells.cellsForHost.mock.calls.map((call) => call[1]);
    expect(hosts).toEqual(['root', 'child', 'grand']);
    expect(writer.writeNode).toHaveBeenCalledTimes(3);
  });

  it('зависимые и свои ячейки не дублируются, глубина — из события', async () => {
    const { service, cells, writer } = make();
    await service.recalcNodeCells({} as never, null, PROJECT, 'root', [5], 3);
    expect(cells.recalc).toHaveBeenCalledTimes(2);
    expect(cells.recalc).toHaveBeenCalledWith(expect.anything(), expect.anything(), 3);
    expect(writer.writeNode).toHaveBeenCalledTimes(2);
  });

  it('значение не изменилось — писатель и событие не зовутся (шум-контроль)', async () => {
    const { service, cells, writer, eventBus } = make();
    cells.recalc.mockResolvedValue({ value: 7, error: null, changed: false, silent: false });
    await service.recalcNodeCells({} as never, null, PROJECT, 'root', [], 1);
    expect(writer.writeNode).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('сбой писателя изолирован per-cell: партия не падает (Р4)', async () => {
    const { service, writer, eventBus, logger } = make();
    writer.writeNode.mockRejectedValueOnce(new Error('not_in_type'));
    await expect(
      service.recalcStructure({} as never, null, PROJECT, ['root'], 1),
    ).resolves.toBeUndefined();
    expect(writer.writeNode).toHaveBeenCalledTimes(3);
    expect(logger.debug).toHaveBeenCalled();
    // Ячейка с ошибкой записи событие формулы не эмитит (значение не легло).
    expect(eventBus.emit).toHaveBeenCalledTimes(2);
  });

  it('ячейка проекта: значение — писателем проекта, глубина каскада — cycle молчит', async () => {
    const { service, cells, writer, eventBus } = make();
    cells.cellsForHost.mockResolvedValue([
      { cellId: 'p1', hostKind: 'project', hostId: PROJECT, fieldId: FIELD },
    ]);
    await service.recalcProjectCells({} as never, null, PROJECT, [], 2);
    expect(writer.writeProject).toHaveBeenCalledWith(expect.anything(), null, PROJECT, FIELD, 7);
    cells.recalc.mockResolvedValueOnce({ value: null, error: null, changed: true, silent: true });
    await service.recalcProjectCells({} as never, null, PROJECT, [], 2);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });
});
