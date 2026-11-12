import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { ProjectSecretPreviewService } from './project-secret-preview.service.js';

const ID = '00000000-0000-4000-8000-000000000001';
const MANAGER = '00000000-0000-4000-8000-0000000000a1';
const WORKER = '00000000-0000-4000-8000-0000000000a2';
const HELPER = '00000000-0000-4000-8000-0000000000a3';
const JOINED = '00000000-0000-4000-8000-0000000000a4';
const OBSERVER = '00000000-0000-4000-8000-0000000000a5';
const DECIDER = '00000000-0000-4000-8000-0000000000a6';

const user = (id: string, permissions: string[] = []) => ({
  id,
  email: 'u@nodus.by',
  displayName: id,
  permissions,
});

const participant = (userId: string, source: string, observerKind: string | null = null) => ({
  projectId: ID,
  userId,
  source,
  observerKind,
  createdAt: new Date(),
});

/** Превью перевода в секретный (#541, решение владельца п.4): списки
 *  «останутся участниками» и «потеряют доступ» без противоречий. */
describe('ProjectSecretPreviewService (#541)', () => {
  const projects = { findById: vi.fn() };
  const participants = { hasRow: vi.fn(), rowsOfProject: vi.fn() };
  const tasks = { staffingOf: vi.fn() };
  const profiles = { findRefs: vi.fn() };
  const service = new ProjectSecretPreviewService(
    projects as never,
    participants as never,
    tasks as never,
    profiles as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    projects.findById.mockResolvedValue({ id: ID, visibility: 'open', status: 'active' });
    participants.hasRow.mockResolvedValue(true);
    participants.rowsOfProject.mockResolvedValue([
      participant(MANAGER, 'manager'),
      participant(WORKER, 'member'),
      participant(JOINED, 'observer', 'joined'),
      participant(HELPER, 'observer', 'invited'),
    ]);
    tasks.staffingOf.mockResolvedValue({
      holders: [{ userId: WORKER, roles: ['assignee'], taskCount: 2 }],
      deciderIds: [DECIDER],
      observers: [
        { userId: OBSERVER, taskCount: 3 },
        { userId: HELPER, taskCount: 1 },
      ],
    });
    profiles.findRefs.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, displayName: id, avatarUrl: null })),
    );
  });

  it('кто станет участником и кто потеряет доступ — без двойного счёта', async () => {
    const preview = await service.secretPreview(user(MANAGER), ID);

    expect(preview.willBecomeMembers.map((item) => item.user.id)).toEqual([WORKER, DECIDER]);
    expect(preview.willBecomeMembers[0]).toMatchObject({
      roles: ['assignee'],
      taskCount: 2,
    });
    expect(preview.willBecomeMembers[1]).toMatchObject({ roles: ['decider'], taskCount: 0 });
    // Самовступивший и наблюдатель задачи вне состава — теряют доступ;
    // приглашённый наблюдатель остаётся.
    expect(preview.willLoseAccess.map((item) => item.user.id)).toEqual([JOINED, OBSERVER]);
    expect(preview.willLoseAccess.map((item) => item.kind)).toEqual(['joined', 'observer']);
    // Превью конфиденциальных задач фильтруется по смотрящему (#461).
    expect(tasks.staffingOf).toHaveBeenCalledWith(ID, { viewerId: MANAGER });
  });

  it('не руководство проекта — 403', async () => {
    participants.rowsOfProject.mockResolvedValue([participant(WORKER, 'member')]);
    await expect(service.secretPreview(user(OBSERVER), ID)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('профиль не найден — честная строка без имени', async () => {
    profiles.findRefs.mockResolvedValue([]);
    const preview = await service.secretPreview(user(MANAGER), ID);
    expect(preview.willBecomeMembers[0]?.user.displayName).toBe('');
  });
});
