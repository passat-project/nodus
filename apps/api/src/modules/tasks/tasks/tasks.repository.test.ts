import { describe, expect, it, vi } from 'vitest';

import { DuplicateTaskSourceError, TasksRepository, type NewTaskData } from './tasks.repository.js';

const DATA = {
  title: 'T',
  sourceId: 'm1',
  source: 'chat_message',
  participants: [{ userId: 'u', role: 'observer', muted: true }],
} as unknown as NewTaskData;

const unique = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

describe('TasksRepository.create', () => {
  it('участники — вложенным созданием того же INSERT', async () => {
    const create = vi.fn().mockResolvedValue({ id: 't1' });
    await new TasksRepository({} as never).create(DATA, { task: { create } } as never);
    expect(create).toHaveBeenCalledWith({
      data: {
        title: 'T',
        sourceId: 'm1',
        source: 'chat_message',
        customFields: {},
        // Замки окна создания (#496): карта в той же строке.
        fieldLocks: {},
        participants: { create: DATA.participants },
      },
    });
  });

  it('P2002 у задачи с источником → DuplicateTaskSourceError (дедуп «В задачу»)', async () => {
    const tx = { task: { create: vi.fn().mockRejectedValue(unique) } };
    await expect(new TasksRepository({} as never).create(DATA, tx as never)).rejects.toBeInstanceOf(
      DuplicateTaskSourceError,
    );
  });

  it('P2002 у ручной задачи — исходная ошибка (дедупа нет)', async () => {
    const tx = { task: { create: vi.fn().mockRejectedValue(unique) } };
    await expect(
      new TasksRepository({} as never).create({ ...DATA, sourceId: null }, tx as never),
    ).rejects.toBe(unique);
  });
});
