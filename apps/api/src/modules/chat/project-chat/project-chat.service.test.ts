import { describe, expect, it, vi } from 'vitest';

import { ProjectChatService } from './project-chat.service.js';

const PROJECT = '00000000-0000-4000-8000-000000000101';
const CONV = '00000000-0000-4000-8000-000000000102';
const TX = 'tx-1';

const ROSTER = {
  managerId: '00000000-0000-4000-8000-000000000201',
  memberIds: ['00000000-0000-4000-8000-000000000202'],
};

type Roster = { managerId: string; memberIds: string[] } | null;

/**
 * AUD-022: первое чтение состава — до открытия транзакции (findOrCreate:
 * managerId); под `FOR UPDATE` беседы состав перечитывается соединением
 * транзакции — иначе конкурентный sync со старым составом вернул бы
 * исключённого (#252), а пул получал бы второе соединение внутри tx.
 */
function setup(opts: {
  roster?: Roster;
  rosterAfterLock?: Roster;
  existing?: boolean;
  current?: string[];
  roles?: string[];
}) {
  const order: string[] = [];
  let rosterReads = 0;
  const repo = {
    find: vi.fn(async () => (opts.existing === false ? null : CONV)),
    findOrCreate: vi.fn(async () => ({ id: CONV, created: true })),
    lock: vi.fn(async () => void 0),
    members: vi.fn(async () => opts.current ?? []),
    roles: vi.fn(async () =>
      (opts.roles ?? []).map((userId) => ({
        userId,
        role: userId === ROSTER.managerId ? 'owner' : 'member',
      })),
    ),
    updateRoles: vi.fn(async () => void 0),
    addMembers: vi.fn(async (_tx: unknown, _id: string, rows: { userId: string }[]) =>
      rows.map((row) => row.userId),
    ),
    removeMembers: vi.fn(async () => void 0),
  };
  const projects = {
    roster: vi.fn(async () => {
      order.push('roster');
      rosterReads += 1;
      if (rosterReads > 1 && opts.rosterAfterLock !== undefined) {
        return opts.rosterAfterLock;
      }
      return opts.roster === undefined ? ROSTER : opts.roster;
    }),
    refs: vi.fn(async () => {
      order.push('refs');
      return [{ id: PROJECT, name: 'Проект' }];
    }),
  };
  const eventBus = { emit: vi.fn(async () => void 0) };
  const service = new ProjectChatService(
    repo as never,
    {
      run: (fn: (tx: unknown) => unknown) => {
        order.push('tx');
        return fn(TX);
      },
    } as never,
    eventBus as never,
    projects as never,
  );
  return { service, repo, projects, eventBus, order };
}

describe('ProjectChatService.sync (#52 Р8, AUD-022)', () => {
  it('roster читается ДО транзакции и повторно — под блокировкой беседы', async () => {
    const { service, projects, order } = setup({
      current: [ROSTER.managerId, ...ROSTER.memberIds],
    });
    await service.sync(PROJECT, 'actor-1');
    // Первое чтение — до tx (findOrCreate), название — тоже; свежий состав —
    // уже внутри транзакции, после FOR UPDATE беседы (гейт #252), соединением
    // самой транзакции (AUD-022: второй коннект пула не занимается).
    expect(order).toEqual(['roster', 'refs', 'tx', 'roster']);
    expect(projects.roster).toHaveBeenNthCalledWith(1, PROJECT);
    expect(projects.roster).toHaveBeenNthCalledWith(2, PROJECT, TX);
  });

  it('конкурентный sync со старым составом не возвращает исключённого', async () => {
    const excluded = ROSTER.memberIds[0]!;
    const { service, repo } = setup({
      // До транзакции проект ещё включал участника; под замком его уже убрали.
      roster: { managerId: ROSTER.managerId, memberIds: [excluded] },
      rosterAfterLock: { managerId: ROSTER.managerId, memberIds: [] },
    });

    await expect(service.sync(PROJECT, 'actor-1')).resolves.toBe(CONV);

    const added = repo.addMembers.mock.calls.flatMap(
      (_args: unknown[]) => (_args[2] as { userId: string }[] | undefined) ?? [],
    );
    expect(added.map((row) => row.userId)).not.toContain(excluded);
  });

  it('проект исчез под блокировкой — состав распущен, sync возвращает null', async () => {
    const { service, repo } = setup({
      roster: ROSTER,
      rosterAfterLock: null,
      current: [ROSTER.managerId, ...ROSTER.memberIds],
    });

    await expect(service.sync(PROJECT, 'actor-1')).resolves.toBeNull();

    expect(repo.removeMembers).toHaveBeenCalledWith(TX, CONV, [
      ROSTER.managerId,
      ...ROSTER.memberIds,
    ]);
  });

  it('состав = roster проекта: руководитель owner, новые — member, выбывший уходит', async () => {
    const stranger = '00000000-0000-4000-8000-000000000299';
    const { service, repo, eventBus } = setup({
      current: [ROSTER.managerId, stranger],
      roles: [ROSTER.managerId, stranger],
    });
    await service.sync(PROJECT, 'actor-1');
    expect(repo.addMembers).toHaveBeenCalledWith(TX, CONV, [
      { userId: ROSTER.memberIds[0], role: 'member' },
    ]);
    expect(repo.removeMembers).toHaveBeenCalledWith(TX, CONV, [stranger]);
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      'chat.member_removed',
      expect.objectContaining({ userId: stranger }),
      expect.anything(),
    );
  });

  it('новая беседа: findOrCreate получает название проекта и руководителя', async () => {
    const { service, repo, eventBus } = setup({ existing: false });
    await expect(service.sync(PROJECT, 'actor-1')).resolves.toBe(CONV);
    expect(repo.findOrCreate).toHaveBeenCalledWith(TX, PROJECT, 'Проект: Проект', ROSTER.managerId);
    expect(eventBus.emit).toHaveBeenCalledWith(
      TX,
      'chat.conversation_created',
      expect.objectContaining({ type: 'project_channel' }),
      expect.anything(),
    );
  });

  it('проекта нет — null до открытия транзакции', async () => {
    const { service, order } = setup({ roster: null });
    await expect(service.sync(PROJECT, 'actor-1')).resolves.toBeNull();
    expect(order).toEqual(['roster']);
  });
});
