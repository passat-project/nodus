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
  const tasks = { findWithParticipants: vi.fn(async () => ({ ...TASK, ...overrides })) };
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
