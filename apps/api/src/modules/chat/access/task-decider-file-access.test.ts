import { describe, expect, it, vi } from 'vitest';

import { TaskDeciderFileAccess } from './task-decider-file-access.js';

describe('TaskDeciderFileAccess (#433)', () => {
  it('файл задачи решающему — просмотр без правки', async () => {
    const repository = { taskIdsByFileId: vi.fn(async () => ['task-1']) };
    const tasks = { isDecider: vi.fn(async () => true) };
    const access = new TaskDeciderFileAccess(repository as never, tasks as never);
    await expect(access.check('file-1', 'u1')).resolves.toEqual({
      canView: true,
      canEdit: false,
    });
  });

  it('не решающий и файл вне задачи — решение не наше (null)', async () => {
    const repository = { taskIdsByFileId: vi.fn(async () => ['task-1']) };
    const tasks = { isDecider: vi.fn(async () => false) };
    const access = new TaskDeciderFileAccess(repository as never, tasks as never);
    await expect(access.check('file-1', 'u1')).resolves.toBeNull();

    repository.taskIdsByFileId.mockResolvedValue([]);
    await expect(access.check('file-1', 'u1')).resolves.toBeNull();
  });
});
