import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { ProjectsQueryService } from './projects-query.service.js';

const ID = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const MEMBER = '00000000-0000-4000-8000-0000000000a2';

function user(id: string, permissions: string[] = []): AuthUser {
  return { id, email: 'u@nodus.by', displayName: 'u', permissions };
}

function ref(id: string) {
  return { id, displayName: `user-${id.slice(-2)}`, avatarUrl: null };
}

describe('ProjectsQueryService.history (#52)', () => {
  const repo = { findById: vi.fn(), findPage: vi.fn() };
  const participantsRepo = { hasRow: vi.fn() };
  const historyRepo = { findPage: vi.fn(), findLastVisibilityChangeSeq: vi.fn() };
  const mapper = { toDetail: vi.fn(), toListItems: vi.fn() };
  const profiles = { findRefs: vi.fn() };

  const service = new ProjectsQueryService(
    repo as never,
    participantsRepo as never,
    historyRepo as never,
    mapper as never,
    profiles as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    repo.findById.mockResolvedValue({ id: ID, visibility: 'open' });
    participantsRepo.hasRow.mockResolvedValue(false);
    historyRepo.findLastVisibilityChangeSeq.mockResolvedValue(null);
    profiles.findRefs.mockResolvedValue([ref(ACTOR), ref(MEMBER)]);
  });

  it('outbox-события агрегата → лента: created / status_changed / participants_changed', async () => {
    historyRepo.findPage.mockResolvedValue([
      {
        id: 'e-3',
        type: 'project.participants_changed',
        actorId: ACTOR,
        payload: { projectId: ID, changedUserIds: [MEMBER] },
        createdAt: new Date('2026-11-07T10:00:00.000Z'),
        seq: 30n,
      },
      {
        id: 'e-2',
        type: 'project.updated',
        actorId: ACTOR,
        payload: { projectId: ID, fields: ['status'], status: 'completed' },
        createdAt: new Date('2026-11-06T10:00:00.000Z'),
        seq: 20n,
      },
      {
        id: 'e-1',
        type: 'project.created',
        actorId: null,
        payload: { projectId: ID, name: 'Тендер УП' },
        createdAt: new Date('2026-11-05T10:00:00.000Z'),
        seq: 10n,
      },
    ]);

    const page = await service.history(user(ACTOR), ID, null, 10);

    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => item.kind)).toEqual([
      'participants_changed',
      'status_changed',
      'created',
    ]);
    expect(page.items[0]?.users).toEqual([ref(MEMBER)]);
    expect(page.items[1]?.status).toBe('completed');
    expect(page.items[1]?.actor).toEqual(ref(ACTOR));
    expect(page.items[2]?.name).toBe('Тендер УП');
    expect(page.items[2]?.actor).toBeNull();
  });

  it('есть лишняя строка — nextCursor по seq последней страницы', async () => {
    const rows = [1, 2, 3].map((n) => ({
      id: `e-${n}`,
      type: 'project.updated',
      actorId: ACTOR,
      payload: { projectId: ID, fields: ['name'] },
      createdAt: new Date('2026-11-07T10:00:00.000Z'),
      seq: BigInt(100 - n),
    }));
    historyRepo.findPage.mockResolvedValue(rows);

    const page = await service.history(user(ACTOR), ID, null, 2);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it('секретный проект не-участнику → 404 (лента не оракул существования)', async () => {
    repo.findById.mockResolvedValue({ id: ID, visibility: 'secret' });
    participantsRepo.hasRow.mockResolvedValue(false);
    await expect(service.history(user(ACTOR), ID, null, 10)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('открытый бывший секретным: не-участник видит ленту с последнего раскрытия (#748)', async () => {
    historyRepo.findLastVisibilityChangeSeq.mockResolvedValue(15n);
    historyRepo.findPage.mockResolvedValue([]);

    await service.history(user(ACTOR), ID, null, 10);

    expect(historyRepo.findPage).toHaveBeenCalledWith(ID, null, 10, 15n);
  });

  it('участник открытого проекта видит полную историю (#748)', async () => {
    historyRepo.findLastVisibilityChangeSeq.mockResolvedValue(15n);
    participantsRepo.hasRow.mockResolvedValue(true);
    historyRepo.findPage.mockResolvedValue([]);

    await service.history(user(ACTOR), ID, null, 10);

    expect(historyRepo.findLastVisibilityChangeSeq).not.toHaveBeenCalled();
    expect(historyRepo.findPage).toHaveBeenCalledWith(ID, null, 10, null);
  });

  it('project.view_secret видит полную историю открытого проекта (#748)', async () => {
    historyRepo.findLastVisibilityChangeSeq.mockResolvedValue(15n);
    historyRepo.findPage.mockResolvedValue([]);

    await service.history(user(ACTOR, ['project.view_secret']), ID, null, 10);

    expect(historyRepo.findLastVisibilityChangeSeq).not.toHaveBeenCalled();
    expect(historyRepo.findPage).toHaveBeenCalledWith(ID, null, 10, null);
  });

  it('открытый проект без смен видимости — граница не нужна (#748)', async () => {
    historyRepo.findLastVisibilityChangeSeq.mockResolvedValue(null);
    historyRepo.findPage.mockResolvedValue([]);

    await service.history(user(ACTOR), ID, null, 10);

    expect(historyRepo.findPage).toHaveBeenCalledWith(ID, null, 10, null);
  });

  it('секретный проект участнику — полная лента, граница не запрашивается (#748)', async () => {
    repo.findById.mockResolvedValue({ id: ID, visibility: 'secret' });
    participantsRepo.hasRow.mockResolvedValue(true);
    historyRepo.findPage.mockResolvedValue([]);

    await service.history(user(ACTOR), ID, null, 10);

    expect(historyRepo.findLastVisibilityChangeSeq).not.toHaveBeenCalled();
    expect(historyRepo.findPage).toHaveBeenCalledWith(ID, null, 10, null);
  });
});
