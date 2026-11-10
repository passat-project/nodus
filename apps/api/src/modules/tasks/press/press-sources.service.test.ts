import { describe, expect, it, vi } from 'vitest';

import { PressSourcesService } from './press-sources.service.js';

const TASK = {
  id: 't1',
  typeId: 'type1',
  creatorId: 'creator',
  assigneeId: 'assignee',
  confidential: false,
  customFields: {},
  participants: [
    { userId: 'co1', role: 'coexecutor' },
    { userId: 'co2', role: 'coexecutor' },
    { userId: 'obs', role: 'observer' },
  ],
};

const FIELD1 = 'a0000000-0000-4000-8000-000000000001';
const FIELD2 = 'a0000000-0000-4000-8000-000000000002';

function service(taskOverrides: Record<string, unknown> = {}) {
  const task = { ...TASK, ...taskOverrides };
  const tasks = { findWithParticipants: vi.fn(async () => task) };
  const org = { holdersOfPosition: vi.fn(async () => [{ id: 'holder', displayName: 'Держатель' }]) };
  const users = {
    filterActiveUserIds: vi.fn(async (ids: string[]) => ids),
    listActiveIds: vi.fn(async () => ['u1', 'u2', 'creator']),
    findRefs: vi.fn(async () => []),
  };
  const customFields = {
    definitions: vi.fn(async () => [
      { id: FIELD1, name: 'Сотрудники', type: 'users' },
      { id: FIELD2, name: 'Текст', type: 'text' },
    ]),
  };
  const projects = {
    visibilityOf: vi.fn(async (): Promise<'open' | 'secret' | null> => 'open'),
  };
  const projectChat = {
    roster: vi.fn(async () => ({ managerId: 'manager', memberIds: ['co1', 'co2'] })),
  };
  const sources = new PressSourcesService(
    tasks as never,
    org as never,
    users as never,
    customFields as never,
    projects as never,
    projectChat as never,
  );
  return { sources, tasks, org, users, customFields, projects, projectChat };
}

const config = (sources: unknown[], excludeAuthor = true) =>
  ({ sources, quorum: { kind: 'all' }, order: 'parallel', excludeAuthor }) as never;

describe('PressSourcesService (#434)', () => {
  it('соисполнители без автора, порядок источников сохраняется', async () => {
    const { sources } = service();
    await expect(
      sources.resolve({} as never, 't1', config([{ kind: 'coexecutors' }])),
    ).resolves.toEqual([
      { userId: 'co1', order: 0 },
      { userId: 'co2', order: 1 },
    ]);
  });

  it('роль «ответственный + соисполнители» и исключение автора', async () => {
    const { sources } = service({ creatorId: 'co1' });
    await expect(
      sources.resolve(
        {} as never,
        't1',
        config([{ kind: 'role', roles: ['assignee', 'coexecutor'] }]),
      ),
    ).resolves.toEqual([
      { userId: 'assignee', order: 0 },
      { userId: 'co2', order: 1 },
    ]);
  });

  it('должность и поле «Сотрудники» разворачиваются в людей', async () => {
    const { sources } = service({ customFields: { [FIELD1]: ['u2', 'u1'] } });
    await expect(
      sources.resolve(
        {} as never,
        't1',
        config([
          { kind: 'position', positionId: 'p1', positionKind: 'management' },
          { kind: 'field', field: `cf.${FIELD1}` },
        ]),
      ),
    ).resolves.toEqual([
      { userId: 'holder', order: 0 },
      { userId: 'u2', order: 1 },
      { userId: 'u1', order: 2 },
    ]);
  });

  it('«Все сотрудники» на конфиденциальной задаче не раскрывается', async () => {
    const { sources, users } = service({ confidential: true });
    await expect(
      sources.resolve({} as never, 't1', config([{ kind: 'all_employees' }])),
    ).resolves.toEqual([]);
    expect(users.listActiveIds).not.toHaveBeenCalled();
  });

  it('«Все сотрудники» на задаче проекта не раскрывается', async () => {
    const { sources, users } = service({ projectId: 'project-1' });
    await expect(
      sources.resolve({} as never, 't1', config([{ kind: 'all_employees' }])),
    ).resolves.toEqual([]);
    expect(users.listActiveIds).not.toHaveBeenCalled();
  });

  it('конкретные сотрудники сохраняют порядок источника (очередь)', async () => {
    const { sources, users } = service();
    users.filterActiveUserIds.mockImplementation(async (ids: string[]) => [...ids].reverse());
    await expect(
      sources.resolve(
        {} as never,
        't1',
        config([
          {
            kind: 'employees',
            userIds: ['u2', 'u1'],
          },
        ]),
      ),
    ).resolves.toEqual([
      { userId: 'u2', order: 0 },
      { userId: 'u1', order: 1 },
    ]);
  });

  it('поле не-сотрудника игнорируется', async () => {
    const { sources } = service({ customFields: { [FIELD2]: 'u1' } });
    await expect(
      sources.resolve({} as never, 't1', config([{ kind: 'field', field: `cf.${FIELD2}` }])),
    ).resolves.toEqual([]);
  });

  it('явные источники не раскрывают конфиденциальную задачу (#434, security)', async () => {
    const { sources } = service({ confidential: true });
    await expect(
      sources.resolve(
        {} as never,
        't1',
        config([{ kind: 'employees', userIds: ['u1', 'co1', 'assignee'] }], false),
      ),
    ).resolves.toEqual([
      { userId: 'co1', order: 0 },
      { userId: 'assignee', order: 1 },
    ]);
  });

  it('явные источники секретного проекта — только участники проекта', async () => {
    const { sources, projects, projectChat } = service({ projectId: 'secret-1' });
    projects.visibilityOf.mockResolvedValueOnce('secret');
    await expect(
      sources.resolve(
        {} as never,
        't1',
        config([{ kind: 'employees', userIds: ['u1', 'co1', 'obs'] }], false),
      ),
    ).resolves.toEqual([{ userId: 'co1', order: 0 }]);
    expect(projectChat.roster).toHaveBeenCalledWith('secret-1');
  });
});
