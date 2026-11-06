import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, PROJECT_EVENTS, type AuthUser } from '@nodus/contracts';

import { ProjectMembersService } from './project-members.service.js';

const ID = '00000000-0000-4000-8000-000000000001';
const MANAGER = '00000000-0000-4000-8000-0000000000a1';
const HELPER = '00000000-0000-4000-8000-0000000000a2';
const WORKER = '00000000-0000-4000-8000-0000000000a3';
const OUTSIDER = '00000000-0000-4000-8000-0000000000a4';

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
  };
  const tasks = { membersOf: vi.fn(), roleHolderIds: vi.fn(), projectIdOf: vi.fn() };
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
        { projectId: ID, changedUserIds: [OUTSIDER], audience: expect.any(Array) },
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
      await service.leave(user(OUTSIDER), ID);
      expect(participants.remove).toHaveBeenCalledWith({}, ID, [OUTSIDER], 'observer');
    });
  });

  describe('ручной состав (секретный проект)', () => {
    function managementRows() {
      return [
        {
          projectId: ID,
          userId: MANAGER,
          source: 'manager',
          observerKind: null,
          createdAt: new Date(),
        },
        {
          projectId: ID,
          userId: HELPER,
          source: 'assistant',
          observerKind: null,
          createdAt: new Date(),
        },
      ];
    }

    it('руководство добавляет участника; смена роли заменяет старую строку', async () => {
      projects.findById.mockResolvedValue(projectRow({ visibility: 'secret' }));
      participants.rowsOfProject.mockResolvedValue(managementRows());
      await service.addManual(user(MANAGER), ID, WORKER, 'member');
      expect(participants.remove).toHaveBeenCalledWith({}, ID, [WORKER], 'observer');
      expect(participants.add).toHaveBeenCalledWith({}, [
        { projectId: ID, userId: WORKER, source: 'member' },
      ]);

      await service.addManual(user(HELPER), ID, WORKER, 'observer');
      // Роль заменяется: снимается member-ряд, прежний вид наблюдателя
      // сбрасывается (joined → invited), затем пишется invited.
      expect(participants.remove).toHaveBeenCalledWith({}, ID, [WORKER], 'member');
      expect(participants.remove).toHaveBeenLastCalledWith({}, ID, [WORKER], 'observer');
      expect(participants.add).toHaveBeenLastCalledWith({}, [
        { projectId: ID, userId: WORKER, source: 'observer', observerKind: 'invited' },
      ]);
    });

    it('понижение участника до наблюдателя при ролях в задачах — 422 (задачи держат уведомления)', async () => {
      projects.findById.mockResolvedValue(projectRow({ visibility: 'secret' }));
      participants.rowsOfProject.mockResolvedValue([
        ...managementRows(),
        {
          projectId: ID,
          userId: WORKER,
          source: 'member',
          observerKind: null,
          createdAt: new Date(),
        },
      ]);
      tasks.roleHolderIds.mockResolvedValueOnce([WORKER]);
      await expect(service.addManual(user(MANAGER), ID, WORKER, 'observer')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
      expect(participants.add).not.toHaveBeenCalled();
    });

    it('лимит наблюдателей (100) — 422 на ручном добавлении', async () => {
      projects.findById.mockResolvedValue(projectRow({ visibility: 'open' }));
      const observers = Array.from({ length: 100 }, (_, index) => ({
        projectId: ID,
        userId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        source: 'observer',
        observerKind: 'invited',
        createdAt: new Date(),
      }));
      participants.rowsOfProject.mockResolvedValue([...managementRows(), ...observers]);
      await expect(service.addManual(user(MANAGER), ID, WORKER, 'observer')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
    });

    it('открытый проект: участников руками не добавляют (они из задач), наблюдателей — можно', async () => {
      participants.rowsOfProject.mockResolvedValue(managementRows());
      await expect(service.addManual(user(MANAGER), ID, WORKER, 'member')).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });

      await service.addManual(user(MANAGER), ID, WORKER, 'observer');
      expect(participants.add).toHaveBeenCalledWith({}, [
        { projectId: ID, userId: WORKER, source: 'observer', observerKind: 'invited' },
      ]);

      // Снятие наблюдателя в открытом проекте — только ряд observer.
      await service.removeManual(user(MANAGER), ID, WORKER);
      expect(participants.remove).toHaveBeenLastCalledWith({}, ID, [WORKER], 'observer');
    });

    it('не-руководство без project.manage → 403; неактивный пользователь → 404', async () => {
      participants.rowsOfProject.mockResolvedValue([]);
      await expect(service.addManual(user(OUTSIDER), ID, WORKER, 'member')).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });

      participants.rowsOfProject.mockResolvedValue(managementRows());
      projects.findById.mockResolvedValueOnce(projectRow({ visibility: 'secret' }));
      profiles.filterActiveUserIds.mockResolvedValueOnce([]);
      await expect(service.addManual(user(MANAGER), ID, WORKER, 'member')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe('recomputeTaskSource (проекция из задач, Т2)', () => {
    it('открытый: строки task сходят к membersOf; изменения → событие', async () => {
      tasks.membersOf.mockResolvedValueOnce([WORKER, HELPER]);
      participants.replaceTaskSource.mockResolvedValueOnce({ added: [WORKER], removed: [] });
      await service.recomputeTaskSource(ID);
      expect(participants.replaceTaskSource).toHaveBeenCalledWith({}, ID, [WORKER, HELPER]);
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.PARTICIPANTS_CHANGED,
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

  describe('dropOpenRoster (open→secret)', () => {
    it('снимает динамику задач и самовступивших; приглашённый и создатель остаются', async () => {
      participants.rowsOfProject.mockResolvedValueOnce([
        {
          projectId: ID,
          userId: WORKER,
          source: 'task',
          observerKind: null,
          createdAt: new Date(),
        },
        {
          projectId: ID,
          userId: OUTSIDER,
          source: 'observer',
          observerKind: 'joined',
          createdAt: new Date(),
        },
        {
          projectId: ID,
          userId: HELPER,
          source: 'observer',
          observerKind: 'invited',
          createdAt: new Date(),
        },
        {
          projectId: ID,
          userId: MANAGER,
          source: 'observer',
          observerKind: 'creator',
          createdAt: new Date(),
        },
      ]);
      await service.dropOpenRoster({} as never, ID);
      expect(participants.remove).toHaveBeenCalledWith({}, ID, [WORKER], 'task');
      // самовступивший в секретный проект не переносится — состав ручной
      expect(participants.remove).toHaveBeenCalledWith({}, ID, [OUTSIDER], 'observer');
      expect(participants.remove).not.toHaveBeenCalledWith(
        expect.anything(),
        ID,
        [HELPER],
        'observer',
      );
      expect(participants.remove).not.toHaveBeenCalledWith(
        expect.anything(),
        ID,
        [MANAGER],
        'observer',
      );
    });
  });
});
