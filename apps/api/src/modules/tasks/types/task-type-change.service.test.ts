import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { TaskTypeChangeService } from './task-type-change.service.js';

/** Смена типа задачи (#378, #428): право правки, обязательный stageId, если
 *  статуса нет в новом маршруте; тот же статус — без смены стадии; тип чужой
 *  категории — 404 (задача не идёт по маршруту письма). */

const TX = { tx: true };
const S_OLD = '00000000-0000-4000-8000-0000000000a1';
const S_NEW = '00000000-0000-4000-8000-0000000000a2';
const USER = { id: 'bob', permissions: [] } as never;

function setup(
  opts: {
    canEdit?: boolean;
    stages?: { id: string }[];
    category?: string;
    archived?: boolean;
  } = {},
) {
  const row = {
    id: 't1',
    creatorId: opts.canEdit === false ? 'alice' : 'bob',
    assigneeId: opts.canEdit === false ? 'alice' : 'bob',
    participants: [],
    stageId: S_OLD,
    typeId: 'type-old',
  };
  const task = { ...row, number: 3, title: 'Т', systemState: 'active' };
  const stages = (opts.stages ?? [{ id: S_NEW }]).map((s) => ({
    ...s,
    workflowId: 'wf-new',
    code: null,
    name: 'Статус',
    color: 'neutral',
    sortOrder: 0,
    systemState: 'active',
    outcome: null,
    isInitial: false,
    archivedAt: null,
  }));
  const deps = {
    txRunner: { run: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) },
    query: { visibleRow: vi.fn(async () => row) },
    tasks: {
      lock: vi.fn(async () => void 0),
      findWithParticipants: vi.fn(async () => task),
      setType: vi.fn(async () => void 0),
    },
    catalog: {
      typeById: vi.fn(async () => ({
        id: 'type-new',
        name: 'Быстрый',
        category: opts.category ?? 'task',
        archivedAt: opts.archived ? new Date() : null,
        workflowId: 'wf-new',
      })),
      resolveType: vi.fn(async () => ({ id: 'type-new', workflowId: 'wf-new' })),
      liveStages: vi.fn(async () => stages),
      findLiveStage: vi.fn(async (id: string) => stages.find((s) => s.id === id) ?? null),
    },
    placements: { prepare: vi.fn(async () => void 0) },
    mover: { apply: vi.fn(async () => void 0) },
    eventBus: { emit: vi.fn(async () => void 0) },
    taskService: {
      listItem: vi.fn(async () => ({ id: 't1' })),
      numberTargetFor: vi.fn(async () => ({
        host: 'task',
        typeId: 't1',
        folders: [],
        projectId: null,
        portfolioId: null,
        projectTypeId: null,
        parentTaskId: null,
        sources: { self: {} },
      })),
    },
  };
  const service = new TaskTypeChangeService(
    deps.txRunner as never,
    deps.query as never,
    deps.tasks as never,
    deps.catalog as never,
    deps.placements as never,
    deps.mover as never,
    deps.eventBus as never,
    deps.taskService as never,
    { planOnCreate: async () => ({ ok: true, issue: async () => ({}) }) } as never,
  );
  return { service, ...deps };
}

describe('TaskTypeChangeService (#378, #428)', () => {
  it('без права правки — 403', async () => {
    const { service } = setup({ canEdit: false });
    await expect(service.change(USER, 't1', { typeId: 'type-new' })).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('тип чужой категории — 404, ничего не меняется', async () => {
    const { service, tasks } = setup({ category: 'letter' });
    await expect(service.change(USER, 't1', { typeId: 'type-new' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(tasks.setType).not.toHaveBeenCalled();
  });

  it('архивный тип — 404', async () => {
    const { service } = setup({ archived: true });
    await expect(service.change(USER, 't1', { typeId: 'type-new' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('статуса нет в новом маршруте и stageId не передан — 422 с подсказкой', async () => {
    const { service, tasks } = setup();
    await expect(service.change(USER, 't1', { typeId: 'type-new' })).rejects.toMatchObject({
      code: ErrorCode.WORKFLOW_MIGRATION_REQUIRED,
    });
    expect(tasks.setType).not.toHaveBeenCalled();
  });

  it('со stageId: тип + маршрут, переезд стадии (cause=type_change), событие', async () => {
    const { service, tasks, mover, eventBus } = setup();
    await service.change(USER, 't1', { typeId: 'type-new', stageId: S_NEW });
    expect(tasks.setType).toHaveBeenCalledWith(TX, 't1', {
      typeId: 'type-new',
      workflowId: 'wf-new',
    });
    expect(mover.apply).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ id: 't1' }),
      expect.objectContaining({ id: S_NEW }),
      'bob',
      { transitionId: null, cause: 'type_change' },
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      'task.type_changed',
      expect.objectContaining({ typeId: 'type-new', stageId: S_NEW }),
      expect.anything(),
    );
  });

  it('статус есть и в новом маршруте — стадия не меняется', async () => {
    const { service, tasks, mover } = setup({ stages: [{ id: S_OLD }] });
    await service.change(USER, 't1', { typeId: 'type-new' });
    expect(tasks.setType).toHaveBeenCalled();
    expect(mover.apply).not.toHaveBeenCalled();
  });
});
