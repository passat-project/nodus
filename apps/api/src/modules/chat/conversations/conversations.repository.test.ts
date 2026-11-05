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
