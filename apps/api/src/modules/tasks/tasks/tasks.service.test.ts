import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { DuplicateTaskSourceError } from './tasks.repository.js';
import { TaskCreatePolicy } from './task-create.policy.js';
import { TasksService } from './tasks.service.js';

const TX = { tx: true };
const USER = { id: 'alice', displayName: 'Алиса', permissions: [] } as unknown as AuthUser;
const STAGE = {
  id: 's-new',
  name: 'Новая',
  color: 'neutral',
  sortOrder: 0,
  systemState: 'backlog',
  isInitial: true,
  archivedAt: null,
};
const ACTIVE = {
  id: 's-active',
  name: 'В работе',
  color: 'success',
  sortOrder: 1,
  systemState: 'active',
  isInitial: false,
  archivedAt: null,
};

function setup() {
  const repo = {
    stageKeyAt: vi.fn().mockResolvedValue('a0'),
    create: vi.fn().mockResolvedValue({
      id: 't1',
      number: 7,
      title: 'T',
      systemState: 'backlog',
      projectId: null,
      parentId: null,
      source: 'manual',
      sourceId: null,
    }),
    findListRow: vi.fn().mockImplementation((id: string) => Promise.resolve({ id })),
    findLiveIdBySource: vi.fn().mockResolvedValue(null),
    lockTree: vi.fn(),
    liveAncestorId: vi.fn().mockResolvedValue('grand'),
    softDelete: vi.fn(),
    reparentChildren: vi.fn(),
  };
  const checklist = { createInitial: vi.fn() };
  const placementsRepo = { move: vi.fn(), removeAllForTask: vi.fn() };
  const catalog = {
    resolveType: vi.fn().mockResolvedValue({
      id: 'type',
      code: 'task.default',
      name: 'Стандартный',
      category: 'task',
      direction: null,
      workflowId: 'wf',
    }),
    liveStages: vi.fn().mockResolvedValue([STAGE]),
  };
  const boards = {
    findColumn: vi.fn().mockResolvedValue({ id: 'p-new', systemState: 'backlog' }),
  };
  const placements = {
    prepare: vi.fn(),
    sync: vi.fn(),
    topKey: vi.fn().mockResolvedValue('k0'),
  };
  const query = {
    visibleRow: vi.fn().mockResolvedValue({
      id: 't1',
      number: 7,
      creatorId: 'alice',
      assigneeId: 'bob',
      parentId: 'deleted-parent',
      participants: [],
    }),
  };
  const mapper = {
    toListItems: vi.fn().mockImplementation((rows: { id: string }[]) => Promise.resolve(rows)),
  };
  const profiles = {
    filterActiveUserIds: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids)),
  };
  const messages = {
    snapshot: vi.fn().mockResolvedValue({ conversationId: 'c1', excerpt: 'x' }),
    taskDiscussion: vi.fn(),
  };
  const eventBus = { emit: vi.fn() };
  const engine = {
    execute: vi.fn(async () => ({ stage: ACTIVE, recordId: 'rec-1' })),
  };
  const customFields = {
    prepareCreate: vi
      .fn()
      .mockImplementation((_scope, args: { input: unknown }) => Promise.resolve(args.input)),
  };
  const txRunner = { run: vi.fn((fn: (tx: unknown) => unknown) => fn(TX)) };
  const service = new TasksService(
    txRunner as never,
    eventBus as never,
    repo as never,
    checklist as never,
    placementsRepo as never,
    boards as never,
    catalog as never,
    engine as never,
    placements as never,
    query as never,
    mapper as never,
    profiles as never,
    messages as never,
    { supplement: vi.fn(async (roles: Set<string>) => roles) } as never,
    {
      assertTaskProjectVisible: vi.fn(async () => void 0),
      assertMembersAllowed: vi.fn(async () => void 0),
    } as never,
    customFields as never,
    new TaskCreatePolicy(profiles as never),
  );
  return { service, repo, placements, placementsRepo, txRunner, eventBus, catalog, boards, engine };
}

describe('TasksService', () => {
  it('«В задачу»: параллельный клик проиграл unique-дедупу — задача победителя, не 409', async () => {
    const { service, repo } = setup();
    repo.findLiveIdBySource.mockResolvedValueOnce(null).mockResolvedValueOnce('winner');
    repo.create.mockRejectedValueOnce(new DuplicateTaskSourceError());
    const item = await service.create(USER, {
      title: 'Из чата',
      sourceMessageId: '00000000-0000-4000-8000-000000000001',
    } as never);
    expect(item).toEqual({ id: 'winner' });
    expect(repo.findLiveIdBySource).toHaveBeenLastCalledWith(
      'alice',
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('дубль без живого победителя (удалён) — ошибка не глотается', async () => {
    const { service, repo } = setup();
    repo.create.mockRejectedValueOnce(new DuplicateTaskSourceError());
    await expect(
      service.create(USER, { title: 'Из чата', sourceMessageId: 'm1' } as never),
    ).rejects.toBeInstanceOf(DuplicateTaskSourceError);
  });

  it('обычное создание: ключ начала колонки, стартовый чек-лист, размещения', async () => {
    const { service, repo, placements, placementsRepo, engine } = setup();
    await service.create(USER, {
      title: 'Т',
      checklist: ['a'],
      personalStageId: 'p-new',
    } as never);
    expect(repo.stageKeyAt).toHaveBeenCalledWith(TX, 's-new', 0);
    expect(repo.create.mock.calls[0]![0]).toMatchObject({ stageOrder: 'a0', checklistTotal: 1 });
    expect(placements.prepare).toHaveBeenCalledWith(['alice']);
    expect(placements.sync).toHaveBeenCalled();
    expect(placementsRepo.move).toHaveBeenCalledWith(TX, {
      taskId: 't1',
      userId: 'alice',
      stageId: 'p-new',
      sortOrder: 'k0',
    });
    expect(engine.execute).not.toHaveBeenCalled();
  });

  it('создание в колонке «В работе» — переход в той же транзакции (#402)', async () => {
    const { service, repo, boards, catalog, engine, placementsRepo } = setup();
    catalog.liveStages.mockResolvedValue([STAGE, ACTIVE]);
    boards.findColumn.mockResolvedValue({ id: 'p-active', systemState: 'active', outcome: null });
    await service.create(USER, { title: 'Т', personalStageId: 'p-active' } as never);
    // Строка рождается в начальной стадии, цель колонки — переходом.
    expect(repo.create.mock.calls[0]![0]).toMatchObject({
      stageId: 's-new',
      systemState: 'backlog',
    });
    expect(engine.execute).toHaveBeenCalledWith(TX, 't1', 'task', USER, {
      systemState: 'active',
      outcome: null,
    });
    expect(placementsRepo.move).toHaveBeenCalledWith(TX, {
      taskId: 't1',
      userId: 'alice',
      stageId: 'p-active',
      sortOrder: 'k0',
    });
  });

  it('тип резолвится портом «Процессов» с актором: явный выбор — с проверкой создания', async () => {
    const { service, catalog } = setup();
    await service.create(USER, { title: 'Т' } as never);
    expect(catalog.resolveType).toHaveBeenCalledWith(undefined, {
      category: 'task',
      requireCreatable: false,
      actorId: 'alice',
    });
    await service.create(USER, { title: 'Т', typeId: 'type' } as never);
    expect(catalog.resolveType).toHaveBeenCalledWith('type', {
      category: 'task',
      requireCreatable: true,
      actorId: 'alice',
    });
  });

  it('удаление: дети — к ближайшему ЖИВОМУ предку под очередью дерева', async () => {
    const { service, repo, placementsRepo } = setup();
    await service.remove({ ...USER, id: 'alice' }, 't1');
    expect(repo.lockTree).toHaveBeenCalledWith(TX);
    expect(repo.liveAncestorId).toHaveBeenCalledWith(TX, 't1');
    expect(repo.reparentChildren).toHaveBeenCalledWith(TX, 't1', 'grand');
    expect(placementsRepo.removeAllForTask).toHaveBeenCalledWith(TX, 't1');
    expect(repo.lockTree.mock.invocationCallOrder[0]).toBeLessThan(
      repo.liveAncestorId.mock.invocationCallOrder[0]!,
    );
  });
});
