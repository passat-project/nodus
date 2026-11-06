import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, PROJECT_EVENTS, type AuthUser } from '@nodus/contracts';

import { ProjectLifecycleService } from './project-lifecycle.service.js';

const ID = '00000000-0000-4000-8000-000000000001';
const MANAGER = '00000000-0000-4000-8000-0000000000a1';
const HIP = '00000000-0000-4000-8000-0000000000a2';
const HELPER = '00000000-0000-4000-8000-0000000000a3';

function user(id: string, permissions: string[] = []): AuthUser {
  return { id, email: 'u@nodus.by', displayName: 'u', permissions };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    managerId: MANAGER,
    assistantIds: [HELPER],
    visibility: 'open',
    status: 'active',
    completedAt: null,
    archivedAt: null,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
    ...overrides,
  };
}

describe('ProjectLifecycleService (#52: статусы и передача, Т5/Т6)', () => {
  const repo = { update: vi.fn(), touch: vi.fn() };
  const participantsRepo = { rowsOfProject: vi.fn(), add: vi.fn() };
  const members = { syncManagement: vi.fn() };
  const queries = { detail: vi.fn() };
  const projects = { loadForManage: vi.fn() };
  const profiles = { filterActiveUserIds: vi.fn() };
  const txRunner = { run: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) };
  const eventBus = { emit: vi.fn() };
  let service: ProjectLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    projects.loadForManage.mockResolvedValue({ row: row() });
    repo.update.mockResolvedValue(row());
    participantsRepo.rowsOfProject.mockResolvedValue([]);
    profiles.filterActiveUserIds.mockImplementation(async (ids: string[]) => ids);
    queries.detail.mockResolvedValue({ id: ID });
    service = new ProjectLifecycleService(
      txRunner as never,
      eventBus as never,
      repo as never,
      participantsRepo as never,
      members as never,
      queries as never,
      projects as never,
      profiles as never,
    );
  });

  describe('setStatus (Т6: архив — заморозка)', () => {
    it('завершение — метка с таймстемпом; событие updated [status]', async () => {
      await service.setStatus(user(MANAGER), ID, 'completed');
      expect(repo.update).toHaveBeenCalledWith(
        {},
        ID,
        expect.objectContaining({
          status: 'completed',
          completedAt: expect.any(Date),
          archivedAt: null,
        }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        {},
        PROJECT_EVENTS.UPDATED,
        { projectId: ID, fields: ['status'], status: 'completed', audience: expect.any(Array) },
        expect.anything(),
      );
    });

    it('повтор того же статуса — без события (лента «История» не шумит)', async () => {
      projects.loadForManage.mockResolvedValue({ row: row({ status: 'active' }) });
      await service.setStatus(user(MANAGER), ID, 'active');
      expect(repo.update).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('возврат из архива — только руководитель или project.manage (помощник → 403)', async () => {
      projects.loadForManage.mockResolvedValue({ row: row({ status: 'archived' }) });
      await expect(service.setStatus(user(HELPER), ID, 'active')).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
      await service.setStatus(user(MANAGER), ID, 'active');
      expect(repo.update).toHaveBeenCalledWith(
        {},
        ID,
        expect.objectContaining({ status: 'active' }),
      );
      await service.setStatus(user(HELPER, ['project.manage']), ID, 'active');
      expect(repo.update).toHaveBeenCalledTimes(2);
    });

    it('архив пишет archivedAt и чистит completedAt', async () => {
      await service.setStatus(user(MANAGER), ID, 'archived');
      expect(repo.update).toHaveBeenCalledWith(
        {},
        ID,
        expect.objectContaining({
          status: 'archived',
          archivedAt: expect.any(Date),
          completedAt: null,
        }),
      );
    });
  });

  describe('transfer (Т5: передача руководства)', () => {
    it('только действующий руководитель; новый РП вырезается из помощников', async () => {
      await expect(service.transfer(user(HELPER), ID, HIP)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });

      projects.loadForManage.mockResolvedValue({ row: row({ assistantIds: [HELPER, HIP] }) });
      await service.transfer(user(MANAGER), ID, HIP);
      expect(repo.update).toHaveBeenCalledWith({}, ID, { managerId: HIP, assistantIds: [HELPER] });
    });

    it('прежний руководитель без иных источников → наблюдатель-создатель', async () => {
      participantsRepo.rowsOfProject.mockResolvedValueOnce([
        {
          projectId: ID,
          userId: MANAGER,
          source: 'manager',
          observerKind: null,
          createdAt: new Date(),
        },
      ]);
      await service.transfer(user(MANAGER), ID, HIP);
      expect(participantsRepo.add).toHaveBeenCalledWith({}, [
        { projectId: ID, userId: MANAGER, source: 'observer', observerKind: 'creator' },
      ]);
    });

    it('прежний руководитель — действующий помощник: строки observer не появляется', async () => {
      participantsRepo.rowsOfProject.mockResolvedValueOnce([
        {
          projectId: ID,
          userId: MANAGER,
          source: 'manager',
          observerKind: null,
          createdAt: new Date(),
        },
        {
          projectId: ID,
          userId: MANAGER,
          source: 'assistant',
          observerKind: null,
          createdAt: new Date(),
        },
      ]);
      await service.transfer(user(MANAGER), ID, HIP);
      expect(participantsRepo.add).not.toHaveBeenCalled();
      expect(members.syncManagement).toHaveBeenCalledWith(
        {},
        ID,
        { managerId: HIP, assistantIds: [HELPER] },
        [MANAGER, HIP],
      );
    });

    it('неактивный кандидат → 404', async () => {
      profiles.filterActiveUserIds.mockResolvedValueOnce([]);
      await expect(service.transfer(user(MANAGER), ID, HIP)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });
  });
});
