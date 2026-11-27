import { vi } from 'vitest';

import { PressRoundsService } from './press-rounds.service.js';

/** Общие фикстуры тестов раунда сбора (#434, #965): задача, открытый раунд
 *  и сборка сервиса на подставных зависимостях. */

export const TASK = {
  id: 't1',
  number: 1,
  title: 'Задача',
  workflowId: 'wf1',
  stageId: 's1',
  systemState: 'active',
  creatorId: 'creator',
  assigneeId: 'assignee',
  projectId: null,
  confidential: false,
  customFields: {},
  participants: [],
};

export const ROUND = {
  id: 'r1',
  entityKind: 'task',
  entityId: 't1',
  stageId: 's1',
  transitionId: 'tr1',
  transitionName: 'Завершить',
  cycle: 1,
  config: {
    sources: [{ kind: 'coexecutors' }],
    quorum: { kind: 'all' },
    order: 'parallel',
    excludeAuthor: true,
  },
  form: { enabled: false, sections: [] },
  startedAt: new Date(),
  completedAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  entries: [
    {
      id: 'e1',
      roundId: 'r1',
      userId: 'u1',
      order: 0,
      state: 'pressed',
      pressedAt: new Date(),
      input: { result: { text: 'Готово', messageIds: [] } },
      result: { text: 'Готово', messageIds: [], fileCount: 0, minutes: null, date: null },
      timeEntryId: null,
      returnReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
};

export function setup() {
  const repo = {
    findOpenRound: vi.fn(async () => ROUND),
    findLatestCompletedRound: vi.fn(async () => ({ ...ROUND, completedAt: new Date() })),
    findLatestRoundForUser: vi.fn(async () => ({ ...ROUND, completedAt: new Date() })),
    cancelOpenRound: vi.fn(async () => void 0),
    createRound: vi.fn(async () => ROUND),
    nextCycle: vi.fn(async () => 1),
  };
  const sources = { resolve: vi.fn(async () => [{ userId: 'u1', order: 0 }]) };
  const tasks = {
    lock: vi.fn(async () => void 0),
    findWithParticipants: vi.fn(async () => TASK),
  };
  const pressReader = {
    pressTransitionsForStage: vi.fn(async () => [
      { id: 'tr1', name: 'Завершить', sortOrder: 0, press: ROUND.config, form: ROUND.form },
    ]),
  };
  const users = { findRefs: vi.fn(async () => [{ id: 'u1', displayName: 'Иван' }]) };
  const events = { emit: vi.fn(async () => void 0) };
  const pressEvents = {
    updated: vi.fn(async () => void 0),
    completionBlocked: vi.fn(async () => void 0),
  };
  const records = { write: vi.fn(async () => void 0) };
  const service = new PressRoundsService(
    repo as never,
    sources as never,
    tasks as never,
    { lockProject: vi.fn() } as never,
    events as never,
    pressEvents as never,
    pressReader as never,
    users as never,
    records as never,
  );
  return { service, repo, sources, tasks, pressReader, events, pressEvents, records };
}
