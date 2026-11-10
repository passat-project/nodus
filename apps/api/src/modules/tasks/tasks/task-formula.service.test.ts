import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AuthUser, type FieldLocks } from '@nodus/contracts';

import { TaskFormulaService } from './task-formula.service.js';

/**
 * Формула ячейки задачи (#632, Р4/Р10) — move-preview: dry-run переноса в
 * папку. Право — canEdit задачи; дифф считается по видимому поддереву,
 * невидимые задачи в диалог не попадают (Р7), узел чужого проекта — 404
 * без оракула. Ничего не пишется.
 */

const TASK = '63200000-0000-4000-8000-000000000301';
const CHILD = '63200000-0000-4000-8000-000000000302';
const HIDDEN = '63200000-0000-4000-8000-000000000303';
const NODE = '63200000-0000-4000-8000-000000000304';
const PROJECT = '63200000-0000-4000-8000-000000000305';
const FIELD = '63200000-0000-4000-8000-000000000306';

const CREATOR = '63200000-0000-4000-8000-000000000307';
const ASSIGNEE = '63200000-0000-4000-8000-000000000308';
const STRANGER = '63200000-0000-4000-8000-000000000309';

const creator = { id: CREATOR, displayName: 'Автор', permissions: [] } as unknown as AuthUser;
const stranger = { id: STRANGER, displayName: 'Чужой', permissions: [] } as unknown as AuthUser;

const row = {
  id: TASK,
  projectId: PROJECT,
  creatorId: CREATOR,
  assigneeId: ASSIGNEE,
  participants: [],
};

/** Строка диффа move-preview (подпись записи и имена атрибутов). */
const entry = (hostId: string) => ({
  hostKind: 'task' as const,
  hostId,
  fieldId: FIELD,
  hostLabel: 'ПП-12',
  fieldName: 'Сумма',
  from: 10,
  to: 20,
});

function setup(options: { nodeProjectId?: string | null; locks?: FieldLocks } = {}) {
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const query = {
    visibleRow: vi.fn(async () => row),
    subtreeIds: vi.fn(async () => [TASK, CHILD, HIDDEN]),
    visibleIdsAmong: vi.fn(async () => [TASK, CHILD]),
  };
  const repo = {
    findWithParticipants: vi.fn(async () => ({ ...row, fieldLocks: options.locks ?? {} })),
    lock: vi.fn(async () => void 0),
    updateFields: vi.fn(async () => void 0),
  };
  const writer = { apply: vi.fn(async () => void 0) };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const projectRights = { supplement: vi.fn(async (roles: unknown) => roles) };
  const cells = {
    read: vi.fn(async () => ({ ast: null, origin: null })),
    save: vi.fn(async () => ({ value: 10, error: null })),
    remove: vi.fn(async () => void 0),
    depthOf: vi.fn(async () => 0 as number | null),
    preview: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
    dependentCellsByValues: vi.fn(async () => []),
    cellsForHost: vi.fn(
      async (): Promise<
        { cellId: string; hostKind: string; hostId: string; fieldId: string }[]
      > => [],
    ),
    dependentCellsByDepKey: vi.fn(async () => []),
    recalc: vi.fn(async () => ({
      value: 5,
      error: null,
      changed: true,
      errorChanged: false,
      silent: false,
    })),
  };
  const records = {
    record: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      kind: 'node',
      id: NODE,
      projectId: options.nodeProjectId ?? PROJECT,
    })),
  };
  const recalcWriter = {
    recalcOwn: vi.fn(async () => void 0),
    recalcForeign: vi.fn(async () => void 0),
    emitChanged: vi.fn(async () => void 0),
  };
  const service = new TaskFormulaService(
    txRunner as never,
    query as never,
    repo as never,
    writer as never,
    projectRights as never,
    cells as never,
    records as never,
    recalcWriter as never,
  );
  return { service, query, repo, cells, records, writer, eventBus, recalcWriter };
}

describe('TaskFormulaService.movePreview (#632, Р10, критерий 1)', () => {
  it('перенос в папку: дифф по видимому поддереву с подменой узла у корня', async () => {
    const { service, query, cells, records } = setup();
    const changes = [entry(TASK), entry(CHILD)];
    cells.preview.mockResolvedValueOnce(changes);

    expect(await service.movePreview(creator, TASK, NODE)).toEqual({ changes });

    expect(records.record).toHaveBeenCalledWith('node', NODE);
    expect(query.subtreeIds).toHaveBeenCalledWith(TASK);
    // Невидимая задача (Р7) в расчёт не идёт — ни значения, ни подписи.
    expect(query.visibleIdsAmong).toHaveBeenCalledWith(creator, [TASK, CHILD, HIDDEN]);
    expect(cells.preview).toHaveBeenCalledWith('task', [TASK, CHILD], {
      taskNode: { [TASK]: NODE },
    });
  });

  it('вынос из папки (nodeId=null): узел не читается, подмена на null', async () => {
    const { service, cells, records } = setup();
    cells.preview.mockResolvedValueOnce([entry(TASK)]);

    await service.movePreview(creator, TASK, null);

    expect(records.record).not.toHaveBeenCalled();
    expect(cells.preview).toHaveBeenCalledWith('task', [TASK, CHILD], {
      taskNode: { [TASK]: null },
    });
  });

  it('узел чужого проекта — 404 без оракула, расчёт не запускается', async () => {
    const { service, cells } = setup({ nodeProjectId: '63200000-0000-4000-8000-0000000003ff' });
    await expect(service.movePreview(creator, TASK, NODE)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(cells.preview).not.toHaveBeenCalled();
  });

  it('несуществующий узел — тот же 404 (существование не раскрывается)', async () => {
    const { service, cells, records } = setup();
    records.record.mockResolvedValueOnce(null);
    await expect(service.movePreview(creator, TASK, NODE)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(cells.preview).not.toHaveBeenCalled();
  });

  it('нет права правки задачи (не участник, нет task.manage_any) — 403, поддерево не читается', async () => {
    const { service, query, cells } = setup();
    await expect(service.movePreview(stranger, TASK, NODE)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(query.subtreeIds).not.toHaveBeenCalled();
    expect(cells.preview).not.toHaveBeenCalled();
  });

  it('ничего не меняется — пустой список изменений', async () => {
    const { service } = setup();
    expect(await service.movePreview(creator, TASK, NODE)).toEqual({ changes: [] });
  });
});

describe('TaskFormulaService.recalcCells: партия уходит писателю пересчёта (I5)', () => {
  const cell = (id: string) => ({ cellId: id, hostKind: 'task', hostId: TASK, fieldId: FIELD });

  it('свои ячейки передаются recalcOwn, чужие — recalcForeign', async () => {
    const { service, cells, recalcWriter } = setup();
    cells.cellsForHost.mockResolvedValueOnce([cell('c1')]);
    cells.dependentCellsByValues.mockResolvedValueOnce([
      { ...cell('c2'), hostId: 'другая' },
    ] as never);
    await service.recalcCells({} as never, null, TASK, [7], 1);
    expect(recalcWriter.recalcOwn).toHaveBeenCalledWith(
      expect.anything(),
      null,
      TASK,
      expect.arrayContaining([expect.objectContaining({ cellId: 'c1' })]),
      1,
      { includeActor: false },
    );
    expect(recalcWriter.recalcForeign).toHaveBeenCalled();
  });
});

/** Замок записи (#496, Р4): формула ячейки — ручная правка закреплённого. */
describe('TaskFormulaService: замок ячейки (#496)', () => {
  const fieldKey = 'cf.63200000-0000-4000-8000-000000000306';
  const locks = (editors: 'none' | 'owners'): FieldLocks => ({
    [fieldKey]: {
      editors,
      lockedAt: '2026-11-09T00:00:00.000Z',
      lockedBy: CREATOR,
      source: { kind: 'creation' },
    },
  });

  it('замок «никто»: поставить формулу нельзя даже постановщику — 422', async () => {
    const { service, cells } = setup({ locks: locks('none') });
    await expect(
      service.save(creator, TASK, FIELD, { kind: 'literal', value: 1 } as never),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_LOCKED,
      details: { keys: [fieldKey], reason: 'locked' },
    });
    expect(cells.save).not.toHaveBeenCalled();
  });

  it('замок «постановщик»: без причины — 422, с причиной — lastChange', async () => {
    const { service, repo } = setup({ locks: locks('owners') });
    await expect(
      service.save(creator, TASK, FIELD, { kind: 'literal', value: 1 } as never),
    ).rejects.toMatchObject({ details: { reason: 'reason_required' } });
    await service.save(creator, TASK, FIELD, { kind: 'literal', value: 1 } as never, 'пересчёт');
    const data = (
      repo.updateFields.mock.calls[0] as unknown as [
        unknown,
        string,
        {
          fieldLocks: FieldLocks;
        },
      ]
    )[2]!;
    expect(data.fieldLocks[fieldKey]?.lastChange).toMatchObject({
      by: CREATOR,
      reason: 'пересчёт',
    });
  });

  it('снятие формулы закреплённой ячейки — 422', async () => {
    const { service, cells } = setup({ locks: locks('none') });
    await expect(service.remove(creator, TASK, FIELD)).rejects.toMatchObject({
      code: ErrorCode.FIELD_LOCKED,
    });
    expect(cells.remove).not.toHaveBeenCalled();
  });

  it('снятие формулы без ячейки — no-op: значение и события не трогаются (#658)', async () => {
    const { service, cells, writer, recalcWriter } = setup();
    cells.depthOf.mockResolvedValueOnce(null);
    await service.remove(creator, TASK, FIELD);
    expect(cells.remove).not.toHaveBeenCalled();
    expect(writer.apply).not.toHaveBeenCalled();
    expect(recalcWriter.emitChanged).not.toHaveBeenCalled();
  });

  it('без замка формула ставится как раньше', async () => {
    const { service, cells } = setup();
    await service.save(creator, TASK, FIELD, { kind: 'literal', value: 1 } as never);
    expect(cells.save).toHaveBeenCalled();
  });
});
