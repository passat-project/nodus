import { vi, type Mock } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { TaskCreatePolicy } from './task-create.policy.js';
import { TasksService } from './tasks.service.js';

export const TX = { tx: true };
export const USER = { id: 'alice', displayName: 'Алиса', permissions: [] } as unknown as AuthUser;
export const STAGE = {
  id: 's-new',
  name: 'Новая',
  color: 'neutral',
  sortOrder: 0,
  systemState: 'backlog',
  isInitial: true,
  archivedAt: null,
};
export const ACTIVE = {
  id: 's-active',
  name: 'В работе',
  color: 'success',
  sortOrder: 1,
  systemState: 'active',
  outcome: null,
  isInitial: false,
  archivedAt: null,
};
export const CLOSED_INITIAL = {
  id: 's-closed',
  name: 'Завершена',
  color: 'info',
  sortOrder: 2,
  systemState: 'closed',
  outcome: 'success',
  isInitial: true,
  archivedAt: null,
};

export interface TasksServiceFixture {
  service: TasksService;
  repo: {
    stageKeyAt: Mock;
    create: Mock;
    findListRow: Mock;
    findLiveIdBySource: Mock;
    lockTree: Mock;
    liveAncestorId: Mock;
    softDelete: Mock;
    reparentChildren: Mock;
  };
  placements: { prepare: Mock; sync: Mock; topKey: Mock };
  placementsRepo: { move: Mock; removeAllForTask: Mock };
  txRunner: { run: Mock };
  eventBus: { emit: Mock };
  catalog: { resolveType: Mock; liveStages: Mock };
  boards: { findColumn: Mock };
  engine: { execute: Mock };
}

export function setup(): TasksServiceFixture {
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
    refsMany: vi.fn(async () => []),
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
      numberContext: vi.fn(async () => ({ projects: [], nodes: [] })),
    } as never,
    customFields as never,
    { stateFor: vi.fn(async () => new Map()) } as never,
    new TaskCreatePolicy(profiles as never),
    { planOnCreate: async () => ({ ok: true, issue: async () => ({}) }) } as never,
  );
  return { service, repo, placements, placementsRepo, txRunner, eventBus, catalog, boards, engine };
}
