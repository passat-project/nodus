import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { TaskEditService } from './task-edit.service.js';

/** Перенос по личной оси (#402): та же колонка — перестановка без движка;
 *  другая колонка/итог — переход с проверкой; отказ движка пробрасывается. */
const TX = { tx: true };
const USER = { id: 'alice', permissions: [] } as unknown as AuthUser;
const ROW = {
  id: 't1',
  creatorId: 'alice',
  assigneeId: 'alice',
  projectId: null,
  participants: [],
};

function setup(opts: { placementStage?: string } = {}) {
  const engine = {
    execute: vi.fn(async () => ({
      stage: { id: 's2', systemState: 'active', outcome: null },
      recordId: 'r',
    })),
  };
  const boards = {
    findColumn: vi.fn(async () => ({ id: 'p2', systemState: 'active', outcome: null })),
  };
  const placementsRepo = {
    findOne: vi.fn(async () => ({ stageId: opts.placementStage ?? 'p1' })),
    keyAt: vi.fn(async () => 'k1'),
    move: vi.fn(async () => void 0),
  };
  const catalog = {
    findLiveStage: vi.fn(async () => ({
      id: 's1',
      systemState: 'backlog',
      outcome: null,
    })),
  };
  const service = new TaskEditService(
    { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) } as never,
    { emit: vi.fn() } as never,
    {
      stageIdOf: vi.fn(async () => 's1'),
    } as never,
    {
      visibleRow: vi.fn(async () => ROW),
    } as never,
    {
      listItem: vi.fn(async () => ({ id: 't1' })),
      assertActiveUsers: vi.fn(),
      assertCanEditParent: vi.fn(),
    } as never,
    { prepare: vi.fn() } as never,
    placementsRepo as never,
    boards as never,
    {} as never,
    { recalcOwnAfterValuesChange: vi.fn(async () => void 0) } as never,
    { supplement: vi.fn(async (roles: Set<string>) => roles) } as never,
    {} as never,
    engine as never,
    catalog as never,
  );
  return { service, engine, placementsRepo, boards, catalog };
}

describe('TaskEditService.movePersonal (#402)', () => {
  it('перестановка в той же колонке не вызывает переход (отменённая карточка)', async () => {
    const { service, engine, placementsRepo } = setup({ placementStage: 'p1' });
    await service.update(USER, 't1', { personalStageId: 'p1', index: 0 });
    expect(engine.execute).not.toHaveBeenCalled();
    expect(placementsRepo.move).toHaveBeenCalled();
  });

  it('другая колонка другого итога — переход с целевым итогом', async () => {
    const { service, engine, boards, catalog } = setup({ placementStage: 'p1' });
    boards.findColumn.mockResolvedValue({
      id: 'p2',
      systemState: 'closed',
      outcome: 'success',
    } as never);
    catalog.findLiveStage.mockResolvedValue({
      id: 's1',
      systemState: 'closed',
      outcome: 'cancelled',
    } as never);
    engine.execute.mockResolvedValueOnce({
      stage: { id: 's2', systemState: 'closed', outcome: 'success' },
      recordId: 'r',
    } as never);
    await service.update(USER, 't1', { personalStageId: 'p2', index: 0 });
    expect(engine.execute).toHaveBeenCalledWith(TX, 't1', 'task', USER, {
      systemState: 'closed',
      outcome: 'success',
    });
  });

  it('переход ушёл не в ту колонку — NOT_ALLOWED без размещения', async () => {
    const { service, boards, catalog, placementsRepo } = setup({ placementStage: 'p1' });
    boards.findColumn.mockResolvedValue({
      id: 'p2',
      systemState: 'closed',
      outcome: 'success',
    } as never);
    catalog.findLiveStage.mockResolvedValue({
      id: 's1',
      systemState: 'closed',
      outcome: 'cancelled',
    } as never);
    await expect(
      service.update(USER, 't1', { personalStageId: 'p2', index: 0 }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_TRANSITION_NOT_ALLOWED' });
    expect(placementsRepo.move).not.toHaveBeenCalled();
  });

  it('отказ движка (409) пробрасывается, размещение не двигается', async () => {
    const { service, engine, boards, catalog, placementsRepo } = setup({ placementStage: 'p1' });
    boards.findColumn.mockResolvedValue({
      id: 'p2',
      systemState: 'closed',
      outcome: 'success',
    } as never);
    catalog.findLiveStage.mockResolvedValue({
      id: 's1',
      systemState: 'closed',
      outcome: 'cancelled',
    } as never);
    engine.execute.mockRejectedValueOnce(new Error('blocked'));
    await expect(service.update(USER, 't1', { personalStageId: 'p2', index: 0 })).rejects.toThrow(
      'blocked',
    );
    expect(placementsRepo.move).not.toHaveBeenCalled();
  });

  it('stageId DnD: переход ушёл не в целевую стадию — NOT_ALLOWED', async () => {
    const { service, engine } = setup();
    engine.execute.mockResolvedValueOnce({
      stage: { id: 's3', systemState: 'closed', outcome: 'success' },
      recordId: 'r',
    } as never);
    await expect(service.update(USER, 't1', { stageId: 's2', index: 0 })).rejects.toMatchObject({
      code: 'WORKFLOW_TRANSITION_NOT_ALLOWED',
    });
  });
});
