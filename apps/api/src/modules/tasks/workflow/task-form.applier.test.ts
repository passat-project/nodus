import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { TaskFormApplier } from './task-form.applier.js';

const TX = { tx: true } as never;
const TASK = {
  id: 't1',
  number: 7,
  creatorId: 'alice',
  assigneeId: 'bob',
  projectId: null,
  description: 'Старое',
  deadline: new Date('2026-10-30T10:00:00.000Z'),
  plannedMinutes: null,
  participants: [{ userId: 'carol', role: 'observer' }],
};

function setup(overrides: Record<string, unknown> = {}) {
  const tasks = {
    findWithParticipants: vi.fn(async () => ({ ...TASK, ...overrides })),
    updateFields: vi.fn(async () => void 0),
  };
  const writer = { apply: vi.fn(async () => ({ customFieldChanges: [] })) };
  const time = { addManualInTx: vi.fn(async () => ({ id: 'entry-1' })) };
  const revisions = {
    create: vi.fn(async () => ({
      result: { id: 'result-1', text: 'итог', createdAt: new Date() },
      fileCount: 2,
    })),
  };
  const messages = {
    taskMessages: vi.fn(async (_taskId: string, ids: string[]) =>
      ids.map((id) => ({
        messageId: id,
        conversationId: 'c1',
        conversationTitle: null,
        excerpt: '',
        attachmentCount: 1,
      })),
    ),
  };
  const formulas = { recalcOwnAfterValuesChange: vi.fn(async () => void 0) };
  const applier = new TaskFormApplier(
    tasks as never,
    writer as never,
    formulas as never,
    time as never,
    revisions as never,
    messages as never,
    { assertMembersAllowed: vi.fn() } as never,
    { lockedFieldIds: vi.fn(async () => new Set<string>()) } as never,
    { emit: vi.fn(async () => void 0) } as never,
  );
  return { applier, tasks, writer, time, revisions, messages, formulas };
}

const actor = (id: string) => ({ id, permissions: [] });

describe('TaskFormApplier — окно перехода задачи (#380)', () => {
  it('поля: в журнал только реально изменённое, assignee → assigneeId', async () => {
    const { applier, writer } = setup();
    const applied = await applier.apply(TX, 't1', actor('bob'), {
      fields: {
        description: 'Новое',
        deadline: TASK.deadline.toISOString(),
        assigneeId: 'dave',
      },
    });
    expect(writer.apply).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ id: 'bob' }),
      expect.objectContaining({ id: 't1' }),
      { description: 'Новое', assigneeId: 'dave' },
      ['description', 'assigneeId'],
      // Окно без meta (движок не передал) — замков записи не касается.
      {},
    );
    expect(applied.fields).toEqual({
      description: { from: 'Старое', to: 'Новое' },
      assignee: { from: 'bob', to: 'dave' },
    });
  });

  it('время: запись через учёт времени, id — в журнал', async () => {
    const { applier, time } = setup();
    const applied = await applier.apply(TX, 't1', actor('bob'), {
      time: { minutes: 90, date: '2026-10-25' },
    });
    expect(time.addManualInTx).toHaveBeenCalledWith(
      TX,
      'bob',
      { id: 't1', projectId: null },
      { minutes: 90, date: '2026-10-25' },
    );
    expect(applied.timeEntryId).toBe('entry-1');
  });

  it('итог: ревизия и fileCount по вложениям сообщений', async () => {
    const { applier, revisions, messages } = setup();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const applied = await applier.apply(TX, 't1', actor('bob'), {
      result: { text: 'Сделано', messageIds: ids },
    });
    expect(messages.taskMessages).toHaveBeenCalledWith('t1', ids, 'bob', TX);
    expect(revisions.create).toHaveBeenCalledWith(
      TX,
      'bob',
      expect.objectContaining({ id: 't1' }),
      { text: 'Сделано', messageIds: ids },
      expect.any(Array),
    );
    expect(applied.result).toEqual({ resultId: 'result-1', fileCount: 2, messageCount: 2 });
  });

  it('чужое сообщение — одинаковый 404 (без оракула)', async () => {
    const { applier, messages } = setup();
    messages.taskMessages.mockResolvedValueOnce([]);
    await expect(
      applier.apply(TX, 't1', actor('bob'), {
        result: { text: '', messageIds: [crypto.randomUUID()] },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('права разделов: наблюдатель — поля игнорируются, время и итог — 403', async () => {
    const { applier } = setup();
    const observer = actor('carol');
    // Формульные слоты окна шлются always-send и не должны ломать переход
    // актору без права правки: поля просто не применяются (#632).
    await expect(
      applier.apply(TX, 't1', observer, { fields: { description: 'x' } }),
    ).resolves.toBeDefined();
    await expect(
      applier.apply(TX, 't1', observer, { time: { minutes: 5, date: '2026-10-25' } }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await expect(
      applier.apply(TX, 't1', observer, { result: { text: '', messageIds: [] } }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});

describe('TaskFormApplier: синхронный пересчёт формул в tx (#632)', () => {
  it('применённые атрибуты зовут recalcOwnAfterValuesChange с их ключами', async () => {
    const kit = setup();
    const fieldId = '33333333-3333-4333-8333-3333333333f1';
    kit.writer.apply.mockResolvedValueOnce({
      customFieldChanges: [{ fieldId, from: null, to: 'x' }] as never,
    });
    await kit.applier.apply({} as never, 't1', actor('bob'), {
      fields: { customFields: { [fieldId]: 'x' } },
    } as never);
    expect(kit.formulas.recalcOwnAfterValuesChange).toHaveBeenCalledWith(
      expect.anything(),
      'bob',
      't1',
      [fieldId],
    );
  });
});

/** Замки записи в окне кнопки (#496, Р4, В10). */
describe('TaskFormApplier — замки записи (#496)', () => {
  it('окно пишет свои поля мимо замка: writableKeys — в писатель', async () => {
    const { applier, writer } = setup();
    await applier.apply(
      TX,
      't1',
      actor('bob'),
      { fields: { description: 'Новое' } },
      { writableKeys: new Set(['description']) },
    );
    expect(writer.apply).toHaveBeenLastCalledWith(
      TX,
      expect.objectContaining({ id: 'bob' }),
      expect.objectContaining({ id: 't1' }),
      { description: 'Новое' },
      ['description'],
      { writableKeys: new Set(['description']) },
    );
  });

  it('замки кнопки ставятся с источником «кнопка», строже побеждает', async () => {
    const { applier, tasks } = setup({
      fieldLocks: {
        deadline: {
          editors: 'owners',
          lockedAt: '2026-11-09T00:00:00.000Z',
          lockedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          source: { kind: 'creation' },
        },
      },
    });
    await applier.applyLocks(
      TX,
      't1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      [
        { key: 'deadline', editors: 'none' },
        { key: 'description', editors: 'owners' },
      ],
      { transitionId: '11111111-2222-4333-8444-555555555555', transitionName: 'Выдать в печать' },
    );
    const data = (
      tasks.updateFields.mock.calls[0] as unknown as [
        unknown,
        string,
        {
          fieldLocks: Record<string, { editors: string; source: unknown; lockedBy: string }>;
        },
      ]
    )[2]!;
    // Строже побеждает: owners → none заменяет запись целиком.
    expect(data.fieldLocks.deadline).toMatchObject({
      editors: 'none',
      source: {
        kind: 'transition',
        transitionId: '11111111-2222-4333-8444-555555555555',
        name: 'Выдать в печать',
      },
      lockedBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(data.fieldLocks.description).toMatchObject({ editors: 'owners' });
  });

  it('повтор кнопки без изменений не пишет колонку', async () => {
    const { applier, tasks } = setup({
      fieldLocks: {
        deadline: {
          editors: 'none',
          lockedAt: '2026-11-09T00:00:00.000Z',
          lockedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          source: {
            kind: 'transition',
            transitionId: '11111111-2222-4333-8444-555555555555',
            name: 'Старое имя',
          },
        },
      },
    });
    await applier.applyLocks(
      TX,
      't1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      [{ key: 'deadline', editors: 'owners' }],
      { transitionId: '11111111-2222-4333-8444-555555555555', transitionName: 'Выдать' },
    );
    expect(tasks.updateFields).not.toHaveBeenCalled();
  });
});
