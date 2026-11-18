import { describe, expect, it, vi } from 'vitest';

import { ConversationsRepository } from './conversations.repository.js';

describe('ConversationsRepository — читатель-решающий (#433)', () => {
  it('строка читателя помечается readerAccess, обычная — нет', async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [{ id: 'conv-1', role: 'member' }]),
    };
    const repository = new ConversationsRepository(prisma as never);
    await expect(repository.findListItemAsReader('conv-1', 'u-1')).resolves.toMatchObject({
      id: 'conv-1',
      readerAccess: true,
    });

    prisma.$queryRaw.mockResolvedValue([]);
    await expect(repository.findListItemAsReader('conv-1', 'u-1')).resolves.toBeNull();
  });

  it('задача беседы для проверки решающего', async () => {
    const findUnique = vi.fn(async () => ({ taskId: 'task-1' }));
    const repository = new ConversationsRepository({
      conversation: { findUnique },
    } as never);
    await expect(repository.findTaskId('conv-1')).resolves.toBe('task-1');
    findUnique.mockResolvedValue(null as never);
    await expect(repository.findTaskId('conv-2')).resolves.toBeNull();
  });
});

describe('ConversationsRepository — поиск бесед по сущностям (#956)', () => {
  it('добавляет OR по task_id/letter_id только при непустых наборах', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const repository = new ConversationsRepository({ $queryRaw: queryRaw } as never);

    await repository.listForUser('me-1', {
      limit: 10,
      searchTitle: 'ПП-123',
      searchUserIds: ['u-1'],
      searchTaskIds: ['task-1'],
      searchLetterIds: ['letter-1'],
    });

    const sql = queryRaw.mock.calls[0]?.[0] as unknown as { sql: string; values: unknown[] };
    expect(sql.sql).toContain('c.task_id = ANY');
    expect(sql.sql).toContain('c.letter_id = ANY');
    // Prisma.join инлайнит массивы параметрами — разворачиваем вложенность.
    expect(sql.values.flat(Infinity)).toEqual(expect.arrayContaining(['task-1', 'letter-1']));

    queryRaw.mockClear();
    await repository.listForUser('me-1', {
      limit: 10,
      searchTitle: 'ПП-123',
      searchUserIds: [],
      searchTaskIds: [],
      searchLetterIds: [],
    });
    const empty = queryRaw.mock.calls[0]?.[0] as unknown as { sql: string };
    expect(empty.sql).not.toContain('c.task_id = ANY');
    expect(empty.sql).not.toContain('c.letter_id = ANY');
  });
});
