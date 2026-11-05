import { describe, expect, it, vi } from 'vitest';

import { TaskDeciderFileAccessRepository } from './task-decider-file-access.repository.js';

describe('TaskDeciderFileAccessRepository (#433)', () => {
  it('отдаёт задачи бесед, где файл приложен к живому сообщению', async () => {
    const prisma = { $queryRaw: vi.fn(async () => [{ taskId: 'task-1' }]) };
    const repository = new TaskDeciderFileAccessRepository(prisma as never);
    await expect(repository.taskIdsByFileId('file-1')).resolves.toEqual(['task-1']);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});
