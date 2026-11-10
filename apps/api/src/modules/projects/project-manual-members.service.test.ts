import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, PROJECT_EVENTS, type AuthUser } from '@nodus/contracts';

import { ProjectManualMembersService } from './project-manual-members.service.js';

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

/** Ручной состав проекта (#52/Р2, #714): добавление/снятие ролей руководством. */
describe('ProjectManualMembersService (#52/Р2, #714)', () => {
  const projects = { findById: vi.fn(), touch: vi.fn(), lockForUpdate: vi.fn() };
  const participants = {
    rowsOfProject: vi.fn(),
    hasRow: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
  };
  const tasks = { membersOf: vi.fn(), roleHolderIds: vi.fn(), projectIdOf: vi.fn() };
  const profiles = { filterActiveUserIds: vi.fn(), findRefs: vi.fn() };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = { emit: vi.fn() };
  let service: ProjectManualMembersService;

  beforeEach(() => {
    vi.clearAllMocks();
    projects.findById.mockResolvedValue(projectRow());
    projects.lockForUpdate.mockImplementation(async () => {
      const row = await projects.findById();
      return row ? { id: row.id, visibility: row.visibility, status: row.status } : null;
    });
    participants.hasRow.mockResolvedValue(true);
    participants.rowsOfProject.mockResolvedValue([]);
    tasks.roleHolderIds.mockResolvedValue([]);
    profiles.filterActiveUserIds.mockImplementation(async (ids: string[]) => ids);
    service = new ProjectManualMembersService(
      txRunner as never,
      eventBus as never,
      projects as never,
      participants as never,
      tasks as never,
      profiles as never,
    );
  });

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
    expect(eventBus.emit).toHaveBeenCalledWith(
      {},
      PROJECT_EVENTS.PARTICIPANTS_CHANGED,
      expect.objectContaining({
        reason: 'manual',
        changes: [{ userId: WORKER, action: 'added', from: null, to: 'observer' }],
      }),
      expect.anything(),
    );
  });

  it('понижение участника до наблюдателя при ролях в задачах — 422 PROJECT_MEMBER_HAS_TASKS', async () => {
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
      code: ErrorCode.PROJECT_MEMBER_HAS_TASKS,
      details: { userId: WORKER },
    });
    expect(participants.add).not.toHaveBeenCalled();
  });

  it('открытый: наблюдатель участнику из задач отклоняется (#714)', async () => {
    participants.rowsOfProject.mockResolvedValue([
      ...managementRows(),
      {
        projectId: ID,
        userId: WORKER,
        source: 'task',
        observerKind: null,
        createdAt: new Date(),
      },
    ]);
    await expect(service.addManual(user(MANAGER), ID, WORKER, 'observer')).rejects.toMatchObject({
      code: ErrorCode.PROJECT_MEMBER_ALREADY_PARTICIPANT,
      details: { userId: WORKER },
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

  it('повтор той же роли — не действие: без записи и события', async () => {
    participants.rowsOfProject.mockResolvedValue([
      ...managementRows(),
      {
        projectId: ID,
        userId: WORKER,
        source: 'observer',
        observerKind: 'invited',
        createdAt: new Date(),
      },
    ]);
    await service.addManual(user(MANAGER), ID, WORKER, 'observer');
    expect(participants.add).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
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

  it('open: участников руками не добавляют, наблюдателей — можно; снятие — по ручному ряду', async () => {
    participants.rowsOfProject.mockResolvedValue(managementRows());
    await expect(service.addManual(user(MANAGER), ID, WORKER, 'member')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });

    await service.addManual(user(MANAGER), ID, WORKER, 'observer');
    expect(participants.add).toHaveBeenCalledWith({}, [
      { projectId: ID, userId: WORKER, source: 'observer', observerKind: 'invited' },
    ]);

    participants.rowsOfProject.mockResolvedValue([
      ...managementRows(),
      {
        projectId: ID,
        userId: WORKER,
        source: 'observer',
        observerKind: 'invited',
        createdAt: new Date(),
      },
    ]);
    await service.removeManual(user(MANAGER), ID, WORKER);
    expect(participants.remove).toHaveBeenCalledWith({}, ID, [WORKER], 'observer');
    expect(eventBus.emit).toHaveBeenCalledWith(
      {},
      PROJECT_EVENTS.PARTICIPANTS_CHANGED,
      expect.objectContaining({
        reason: 'manual',
        changes: [{ userId: WORKER, action: 'removed', from: 'observer', to: null }],
      }),
      expect.anything(),
    );
  });

  it('open: осевший ручной member снимается самолечением (#714)', async () => {
    participants.rowsOfProject.mockResolvedValue([
      ...managementRows(),
      {
        projectId: ID,
        userId: WORKER,
        source: 'member',
        observerKind: null,
        createdAt: new Date(),
      },
      {
        projectId: ID,
        userId: WORKER,
        source: 'observer',
        observerKind: 'invited',
        createdAt: new Date(),
      },
    ]);
    await service.removeManual(user(MANAGER), ID, WORKER);
    expect(participants.remove).toHaveBeenCalledWith({}, ID, [WORKER], 'member');
    expect(participants.remove).toHaveBeenCalledWith({}, ID, [WORKER], 'observer');
  });

  it('open: снятие участника только из задач — 422 без записи и события', async () => {
    participants.rowsOfProject.mockResolvedValue([
      ...managementRows(),
      {
        projectId: ID,
        userId: WORKER,
        source: 'task',
        observerKind: null,
        createdAt: new Date(),
      },
    ]);
    await expect(service.removeManual(user(MANAGER), ID, WORKER)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_MEMBER_ALREADY_PARTICIPANT,
      details: { userId: WORKER },
    });
    expect(participants.remove).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('secret: снятие держателя ролей в задачах — 422 PROJECT_MEMBER_HAS_TASKS (#714)', async () => {
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
    tasks.roleHolderIds.mockResolvedValue([WORKER]);
    await expect(service.removeManual(user(MANAGER), ID, WORKER)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_MEMBER_HAS_TASKS,
      details: { userId: WORKER },
    });
    expect(participants.remove).not.toHaveBeenCalled();
  });
});
