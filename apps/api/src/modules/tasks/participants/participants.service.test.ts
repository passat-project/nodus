import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AuthUser, type FieldLocks } from '@nodus/contracts';

import { ParticipantsRepository } from './participants.repository.js';
import { ParticipantsService } from './participants.service.js';

const TX = { tx: true };
const user = (id: string) => ({ id, displayName: id, permissions: [] }) as unknown as AuthUser;
const ROW = {
  id: 't1',
  number: 7,
  title: 'T',
  typeId: 'type-1',
  creatorId: 'alice',
  assigneeId: 'bob',
  participants: [
    { userId: 'carol', role: 'observer' },
    { userId: 'dave', role: 'coexecutor' },
  ],
};

function setup(removed = 1, opts: { required?: string[]; left?: number } = {}) {
  const repo = {
    assignRole: vi.fn(),
    remove: vi.fn().mockResolvedValue(removed),
    countRole: vi.fn().mockResolvedValue(opts.left ?? 1),
  };
  const tasksRepo = {
    findWithParticipants: vi.fn().mockResolvedValue(ROW),
    lock: vi.fn(async () => void 0),
    touch: vi.fn(),
  };
  const query = {
    visibleRow: vi.fn().mockResolvedValue(ROW),
    detail: vi.fn().mockResolvedValue({ id: 't1' }),
  };
  const catalog = {
    typeById: vi.fn().mockResolvedValue({
      id: 'type-1',
      category: 'task',
      creationForm: {
        fields: (opts.required ?? []).map((key) => ({
          key,
          label: null,
          required: true,
          preset: null,
        })),
        chips: [],
      },
    }),
  };
  const service = new ParticipantsService(
    { run: (fn: (tx: unknown) => unknown) => fn(TX) } as never,
    { emit: vi.fn() } as never,
    { prepare: vi.fn(), sync: vi.fn() } as never,
    query as never,
    { assertActiveUsers: vi.fn() } as never,
    tasksRepo as never,
    repo as never,
    catalog as never,
    { assertMembersAllowed: vi.fn() } as never,
  );
  return { service, repo };
}

describe('ParticipantsService', () => {
  it('постановщик наблюдателем — конфликт (он и так видит задачу); соисполнителем — можно', async () => {
    const { service, repo } = setup();
    await expect(
      service.add(user('alice'), 't1', { userId: 'alice', role: 'observer' }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    await service.add(user('alice'), 't1', { userId: 'alice', role: 'coexecutor' });
    expect(repo.assignRole).toHaveBeenCalledWith(TX, 't1', 'alice', 'coexecutor');
  });

  it('ответственный участником — конфликт', async () => {
    const { service } = setup();
    await expect(
      service.add(user('alice'), 't1', { userId: 'bob', role: 'coexecutor' }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('снятие несуществующего участника менеджером — 404, не тихий успех', async () => {
    const { service } = setup(0);
    await expect(service.remove(user('alice'), 't1', 'dave')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('самоснятие не-наблюдателя — 403; наблюдатель снимается только в своей роли', async () => {
    const denied = setup(0);
    await expect(denied.service.remove(user('carol'), 't1', 'carol')).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    const ok = setup(1);
    await ok.service.remove(user('carol'), 't1', 'carol');
    expect(ok.repo.remove).toHaveBeenCalledWith(TX, 't1', 'carol', 'observer');
  });
});

describe('ParticipantsRepository.assignRole', () => {
  it('muted следует роли и при смене роли (наблюдатель → соисполнитель включает звук)', async () => {
    const upsert = vi.fn();
    const tx = { taskParticipant: { upsert } };
    await new ParticipantsRepository().assignRole(tx as never, 't1', 'carol', 'coexecutor');
    expect(upsert).toHaveBeenCalledWith({
      where: { taskId_userId: { taskId: 't1', userId: 'carol' } },
      update: { role: 'coexecutor', muted: false },
      create: { taskId: 't1', userId: 'carol', role: 'coexecutor', muted: false },
    });
    await new ParticipantsRepository().assignRole(tx as never, 't1', 'carol', 'observer');
    expect(upsert.mock.calls[1]![0].update).toEqual({ role: 'observer', muted: true });
  });
});

describe('ParticipantsService: обязательные участники (#432, Р5)', () => {
  it('снятие последнего обязательного соисполнителя — 422 reason=clear', async () => {
    const { service } = setup(1, { required: ['coexecutors'], left: 0 });
    await expect(service.remove(user('alice'), 't1', 'dave')).rejects.toMatchObject({
      code: ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED,
      details: { fields: ['coexecutors'], reason: 'clear' },
    });
  });

  it('остались другие — снятие проходит', async () => {
    const { service, repo } = setup(1, { required: ['coexecutors'], left: 2 });
    await service.remove(user('alice'), 't1', 'dave');
    expect(repo.remove).toHaveBeenCalled();
  });

  it('участник не обязателен — снятие последнего проходит', async () => {
    const { service } = setup(1, { required: [], left: 0 });
    await service.remove(user('alice'), 't1', 'dave');
  });
});

/**
 * Замок состава (#496, Р4): закреплённые «Соисполнители»/«Наблюдатели»
 * меняет только постановщик (или `task.edit_locked`) с причиной; отказ —
 * 422 `FIELD_LOCKED`, успешная правка пишет `lastChange`.
 */
describe('ParticipantsService: замок состава (#496, Р4)', () => {
  const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const locks = (editors: 'none' | 'owners'): FieldLocks => ({
    observers: {
      editors,
      lockedAt: '2026-11-09T00:00:00.000Z',
      lockedBy: ALICE,
      source: { kind: 'creation' },
    },
    coexecutors: {
      editors,
      lockedAt: '2026-11-09T00:00:00.000Z',
      lockedBy: ALICE,
      source: { kind: 'creation' },
    },
  });

  function lockSetup(fieldLocks: FieldLocks) {
    const task = { ...ROW, creatorId: ALICE, fieldLocks };
    const repo = {
      assignRole: vi.fn(),
      remove: vi.fn().mockResolvedValue(1),
      countRole: vi.fn().mockResolvedValue(2),
    };
    const tasksRepo = {
      findWithParticipants: vi.fn().mockResolvedValue(task),
      lock: vi.fn(async () => void 0),
      touch: vi.fn(),
      updateFields: vi.fn(async () => void 0),
    };
    const service = new ParticipantsService(
      { run: (fn: (tx: unknown) => unknown) => fn(TX) } as never,
      { emit: vi.fn() } as never,
      { prepare: vi.fn(), sync: vi.fn() } as never,
      { visibleRow: vi.fn().mockResolvedValue(task), detail: vi.fn() } as never,
      { assertActiveUsers: vi.fn() } as never,
      tasksRepo as never,
      repo as never,
      {
        typeById: vi.fn().mockResolvedValue({
          id: 'type-1',
          category: 'task',
          creationForm: { fields: [], chips: [] },
        }),
      } as never,
      { assertMembersAllowed: vi.fn() } as never,
    );
    return { service, repo, tasksRepo };
  }

  it('замок «никто»: добавление наблюдателя — 422 FIELD_LOCKED', async () => {
    const { service, repo } = lockSetup(locks('none'));
    await expect(
      service.add(user('bob'), 't1', { userId: 'new', role: 'observer' }),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_LOCKED,
      details: { keys: ['observers'], reason: 'locked' },
    });
    expect(repo.assignRole).not.toHaveBeenCalled();
  });

  it('постановщик с причиной добавляет — lastChange в колонке', async () => {
    const { service, tasksRepo } = lockSetup(locks('owners'));
    await service.add(user(ALICE), 't1', {
      userId: 'new',
      role: 'observer',
      lockReason: 'нужен контролёр',
    });
    const data = (
      tasksRepo.updateFields.mock.calls[0] as unknown as [
        unknown,
        string,
        { fieldLocks: FieldLocks },
      ]
    )[2]!;
    expect(data.fieldLocks.observers?.lastChange).toMatchObject({
      by: ALICE,
      reason: 'нужен контролёр',
    });
  });

  it('снятие соисполнителя при замке «постановщик» не-постановщиком — owners_only', async () => {
    const { service } = lockSetup(locks('owners'));
    await expect(service.remove(user('bob'), 't1', 'dave', undefined)).rejects.toMatchObject({
      code: ErrorCode.FIELD_LOCKED,
      details: { keys: ['coexecutors'], reason: 'owners_only' },
    });
  });
});
