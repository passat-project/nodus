import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, PROJECT_EVENTS, type AuthUser } from '@nodus/contracts';

import { ProjectMembersService } from './project-members.service.js';

const ID = '00000000-0000-4000-8000-000000000001';
const MANAGER = '00000000-0000-4000-8000-0000000000a1';
const HELPER = '00000000-0000-4000-8000-0000000000a2';
const WORKER = '00000000-0000-4000-8000-0000000000a3';
const OUTSIDER = '00000000-0000-4000-8000-0000000000a4';
const OBSERVER = '00000000-0000-4000-8000-0000000000a5';
const DECIDER = '00000000-0000-4000-8000-0000000000a6';

function user(id: string, permissions: string[] = []): AuthUser {
  return { id, email: 'u@nodus.by', displayName: 'u', permissions };
}

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    visibility: 'open',
    status: 'active',
    managerId: MANAGER,
    assistantIds: [HELPER],
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Автоматическая часть участия (#52, Р2): чтение состава, вступление/уход,
 * проекция из задач и очистка при смене видимости. Ручной состав —
 * project-manual-members.service.test.ts.
 */
describe('ProjectMembersService (#52, Р2 — двухрежимное участие)', () => {
  const projects = { findById: vi.fn(), touch: vi.fn(), lockForUpdate: vi.fn() };
  const participants = {
    rowsOfProject: vi.fn(),
    membersPage: vi.fn(),
    hasRow: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    replaceTaskSource: vi.fn(),
    syncManagement: vi.fn(),
    convertSource: vi.fn(),
  };
  const tasks = {
    membersOf: vi.fn(),
    roleHolderIds: vi.fn(),
    projectIdOf: vi.fn(),
    staffingOf: vi.fn(),
    detachObservers: vi.fn(),
  };
  const profiles = { filterActiveUserIds: vi.fn(), findRefs: vi.fn() };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = { emit: vi.fn() };
  let service: ProjectMembersService;

  beforeEach(() => {
    vi.clearAllMocks();
    projects.findById.mockResolvedValue(projectRow());
    // Блокировка строки в писателях состава отражает текущую видимость проекта.
    projects.lockForUpdate.mockImplementation(async () => {
      const row = await projects.findById();
      return row ? { id: row.id, visibility: row.visibility, status: row.status } : null;
    });
    // Руководитель — участник: assertVisible секретного проекта проходит.
    participants.hasRow.mockResolvedValue(true);
    participants.rowsOfProject.mockResolvedValue([]);
    tasks.membersOf.mockResolvedValue([]);
    tasks.roleHolderIds.mockResolvedValue([]);
    profiles.filterActiveUserIds.mockImplementation(async (ids: string[]) => ids);
    service = new ProjectMembersService(
      txRunner as never,
      eventBus as never,
      projects as never,
      participants as never,
      tasks as never,
      profiles as never,
    );
  });

  describe('join/leave (открытый проект)', () => {
    it('вступление не-участника — наблюдатель-вступивший + событие + подъём журнала', async () => {
      participants.rowsOfProject.mockResolvedValueOnce([]);
      await service.join(user(OUTSIDER), ID);
      expect(participants.add).toHaveBeenCalledWith({}, [
        { projectId: ID, userId: OUTSIDER, source: 'observer', observerKind: 'joined' },
      ]);
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.PARTICIPANTS_CHANGED,
        {
          projectId: ID,
          changedUserIds: [OUTSIDER],
          reason: 'join',
          changes: [{ userId: OUTSIDER, action: 'added', from: null, to: 'observer' }],
          audience: expect.any(Array),
        },
        expect.anything(),
      );
      expect(projects.touch).toHaveBeenCalledWith({}, ID);
    });

    it('повторное вступление идемпотентно; секретный/архивный проект — 404', async () => {
      participants.rowsOfProject.mockResolvedValueOnce([
        {
          projectId: ID,
          userId: OUTSIDER,
          source: 'observer',
          observerKind: 'joined',
          createdAt: new Date(),
        },
      ]);
      await service.join(user(OUTSIDER), ID);
      expect(participants.add).not.toHaveBeenCalled();

      projects.findById.mockResolvedValueOnce(projectRow({ visibility: 'secret' }));
      await expect(service.join(user(OUTSIDER), ID)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it('покинуть — только свой ряд наблюдателя (руководство и динамика задач остаются)', async () => {
      participants.rowsOfProject.mockResolvedValueOnce([
        {
          projectId: ID,
          userId: OUTSIDER,
          source: 'observer',
          observerKind: 'joined',
          createdAt: new Date(),
        },
      ]);
      await service.leave(user(OUTSIDER), ID);
      expect(participants.remove).toHaveBeenCalledWith({}, ID, [OUTSIDER], 'observer');
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.PARTICIPANTS_CHANGED,
        expect.objectContaining({
          reason: 'leave',
          changes: [{ userId: OUTSIDER, action: 'removed', from: 'observer', to: null }],
        }),
        expect.anything(),
      );
    });

    it('покинуть без строки наблюдателя — без события и записи', async () => {
      participants.rowsOfProject.mockResolvedValueOnce([]);
      await service.leave(user(OUTSIDER), ID);
      expect(participants.remove).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('recomputeTaskSource (проекция из задач, Т2)', () => {
    it('открытый: строки task сходят к membersOf; изменения → roster_synced', async () => {
      tasks.membersOf.mockResolvedValueOnce([WORKER, HELPER]);
      participants.replaceTaskSource.mockResolvedValueOnce({ added: [WORKER], removed: [] });
      await service.recomputeTaskSource(ID);
      expect(participants.replaceTaskSource).toHaveBeenCalledWith({}, ID, [WORKER, HELPER]);
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.ROSTER_SYNCED,
        { projectId: ID, changedUserIds: [WORKER], audience: expect.any(Array) },
        expect.anything(),
      );
    });

    it('без изменений — тишина (идемпотентность); секретный — пропуск', async () => {
      participants.replaceTaskSource.mockResolvedValueOnce({ added: [], removed: [] });
      await service.recomputeTaskSource(ID);
      expect(eventBus.emit).not.toHaveBeenCalled();

      projects.findById.mockResolvedValueOnce(projectRow({ visibility: 'secret' }));
      tasks.membersOf.mockClear();
      await service.recomputeTaskSource(ID);
      expect(tasks.membersOf).not.toHaveBeenCalled();
      expect(participants.replaceTaskSource).toHaveBeenCalledTimes(1);
    });
  });

  describe('syncManagement (#699: автоматический пересчёт без истории)', () => {
    it('изменения → roster_synced; notify=false на создании — тишина', async () => {
      participants.syncManagement.mockResolvedValueOnce({ added: [HELPER], removed: [] });
      await service.syncManagement({} as never, ID, { managerId: MANAGER, assistantIds: [] });
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.ROSTER_SYNCED,
        expect.objectContaining({ changedUserIds: [HELPER] }),
        expect.anything(),
      );
      // Payload автоматического состава без имени/шифра проекта: снятый
      // помощник получает событие, но не название секретного проекта (#646).
      const payload = eventBus.emit.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('name');
      expect(payload).not.toHaveProperty('code');

      eventBus.emit.mockClear();
      participants.syncManagement.mockResolvedValueOnce({ added: [WORKER], removed: [] });
      await service.syncManagement(
        {} as never,
        ID,
        { managerId: MANAGER, assistantIds: [WORKER] },
        { notify: false },
      );
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('convertForSecret (open→secret, #541)', () => {
    const row = (userId: string, source: string, observerKind: string | null = null) => ({
      projectId: ID,
      userId,
      source,
      observerKind,
      createdAt: new Date(),
    });
    it('носители ролей задач и решающие становятся участниками; joined и наблюдатели вне состава теряют доступ', async () => {
      participants.rowsOfProject.mockResolvedValueOnce([
        row(WORKER, 'task'),
        row(OUTSIDER, 'observer', 'joined'),
        row(HELPER, 'observer', 'invited'),
        row(MANAGER, 'observer', 'creator'),
      ]);
      await service.convertForSecret({} as never, ID, {
        holders: [{ userId: WORKER, roles: ['assignee'], taskCount: 2 }],
        deciderIds: [DECIDER],
        observers: [
          { userId: OBSERVER, taskCount: 1 },
          { userId: HELPER, taskCount: 3 },
        ],
      });

      // Выданная работа сохраняется: task-строка становится member.
      expect(participants.convertSource).toHaveBeenCalledWith({}, ID, [WORKER], 'task', 'member');
      // Решающий без строки участия добавляется участником.
      expect(participants.add).toHaveBeenCalledWith({}, [
        { projectId: ID, userId: DECIDER, source: 'member' },
      ]);
      // Самовступивший в секретный проект не переносится.
      expect(participants.remove).toHaveBeenCalledWith({}, ID, [OUTSIDER], 'observer');
      // Наблюдатель задачи вне состава теряет роль — события task.* без утечки.
      expect(tasks.detachObservers).toHaveBeenCalledWith({}, ID, [OBSERVER]);
      expect(tasks.detachObservers).not.toHaveBeenCalledWith(
        expect.anything(),
        ID,
        expect.arrayContaining([HELPER]),
      );
      // Системная строка истории с причиной «смена видимости» (#699).
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.PARTICIPANTS_CHANGED,
        expect.objectContaining({
          projectId: ID,
          reason: 'visibility',
          visibility: 'secret',
          changes: expect.arrayContaining([
            { userId: WORKER, action: 'role_changed', from: 'task', to: 'member' },
            { userId: DECIDER, action: 'added', from: null, to: 'member' },
            { userId: OUTSIDER, action: 'removed', from: 'observer', to: null },
          ]),
        }),
        expect.anything(),
      );
    });

    it('носитель роли с joined-строкой становится участником, а не теряет доступ', async () => {
      participants.rowsOfProject.mockResolvedValueOnce([row(WORKER, 'observer', 'joined')]);
      await service.convertForSecret({} as never, ID, {
        holders: [{ userId: WORKER, roles: ['assignee'], taskCount: 1 }],
        deciderIds: [],
        observers: [],
      });

      expect(participants.add).toHaveBeenCalledWith({}, [
        { projectId: ID, userId: WORKER, source: 'member' },
      ]);
      expect(participants.remove).toHaveBeenCalledWith({}, ID, [WORKER], 'observer');
    });
  });

  describe('dropManualRoster (secret→open, #714)', () => {
    it('снимает ручных участников; наблюдатели остаются', async () => {
      participants.rowsOfProject.mockResolvedValueOnce([
        {
          projectId: ID,
          userId: WORKER,
          source: 'member',
          observerKind: null,
          createdAt: new Date(),
        },
        {
          projectId: ID,
          userId: OUTSIDER,
          source: 'observer',
          observerKind: 'invited',
          createdAt: new Date(),
        },
      ]);
      await service.dropManualRoster({} as never, ID);
      expect(participants.remove).toHaveBeenCalledWith({}, ID, [WORKER], 'member');
      expect(participants.remove).not.toHaveBeenCalledWith({}, ID, [OUTSIDER], 'member');
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.PARTICIPANTS_CHANGED,
        expect.objectContaining({
          reason: 'visibility',
          visibility: 'open',
          changes: [{ userId: WORKER, action: 'removed', from: 'member', to: null }],
        }),
        expect.anything(),
      );
    });

    it('ручных участников нет — тишина', async () => {
      participants.rowsOfProject.mockResolvedValueOnce([]);
      await service.dropManualRoster({} as never, ID);
      expect(participants.remove).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });
});
