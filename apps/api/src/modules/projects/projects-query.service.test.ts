import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { ProjectsQueryService } from './projects-query.service.js';

const ID = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const MEMBER = '00000000-0000-4000-8000-0000000000a2';
const EXTRA = '00000000-0000-4000-8000-0000000000a3';

function user(id: string, permissions: string[] = []): AuthUser {
  return { id, email: 'u@nodus.by', displayName: 'u', permissions };
}

function ref(id: string) {
  return { id, displayName: `user-${id.slice(-2)}`, avatarUrl: null };
}

describe('ProjectsQueryService.history (#52)', () => {
  const repo = { findById: vi.fn(), findPage: vi.fn() };
  const participantsRepo = { hasRow: vi.fn() };
  const historyRepo = { findPage: vi.fn() };
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
    profiles.findRefs.mockImplementation(async (ids: string[]) => ids.map(ref));
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
    // Запись старого формата: семантики нет, клиент рендерит сводку по людям.
    expect(page.items[0]?.members).toEqual([]);
    expect(page.items[0]?.reason).toBeNull();
    expect(page.items[0]?.visibility).toBeNull();
    expect(page.items[1]?.status).toBe('completed');
    expect(page.items[1]?.actor).toEqual(ref(ACTOR));
    expect(page.items[2]?.name).toBe('Тендер УП');
    expect(page.items[2]?.actor).toBeNull();
    expect(page.items[2]?.automatic).toBe(false);
  });

  it('пересчёт формулы — automatic: история пометит «Автоматически» (#699)', async () => {
    historyRepo.findPage.mockResolvedValue([
      {
        id: 'e-1',
        type: 'project.updated',
        actorId: ACTOR,
        payload: { projectId: ID, fields: ['cf.f-1'], automatic: true },
        createdAt: new Date('2026-11-08T10:00:00.000Z'),
        seq: 10n,
      },
    ]);
    const page = await service.history(user(ACTOR), ID, null, 10);
    expect(page.items[0]?.automatic).toBe(true);
    expect(page.items[0]?.fields).toEqual(['cf.f-1']);
  });

  it('семантика состава (#699): действия, причина и направление видимости', async () => {
    historyRepo.findPage.mockResolvedValue([
      {
        id: 'e-2',
        type: 'project.participants_changed',
        actorId: ACTOR,
        payload: {
          projectId: ID,
          changedUserIds: [MEMBER],
          reason: 'manual',
          changes: [{ userId: MEMBER, action: 'role_changed', from: 'observer', to: 'member' }],
        },
        createdAt: new Date('2026-11-08T10:00:00.000Z'),
        seq: 20n,
      },
      {
        id: 'e-1',
        type: 'project.participants_changed',
        actorId: null,
        payload: {
          projectId: ID,
          changedUserIds: [EXTRA],
          reason: 'visibility',
          visibility: 'secret',
          changes: [{ userId: EXTRA, action: 'removed', from: 'task', to: null }],
        },
        createdAt: new Date('2026-11-07T10:00:00.000Z'),
        seq: 10n,
      },
    ]);

    const page = await service.history(user(ACTOR), ID, null, 10);

    expect(page.items[0]?.reason).toBe('manual');
    expect(page.items[0]?.members).toEqual([
      { user: ref(MEMBER), action: 'role_changed', from: 'observer', to: 'member' },
    ]);
    expect(page.items[1]?.reason).toBe('visibility');
    expect(page.items[1]?.visibility).toBe('secret');
    expect(page.items[1]?.members).toEqual([
      { user: ref(EXTRA), action: 'removed', from: 'task', to: null },
    ]);
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
});
