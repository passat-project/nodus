import { describe, expect, it } from 'vitest';

import { USER, setup } from './tasks.service.test-helper.js';

/** Замки окна создания (#496, Р4): карта едет в строку того же INSERT. */
describe('TasksService — замки окна создания (#496)', () => {
  it('«Закрепить после создания» — в строке того же INSERT', async () => {
    const { service, repo, catalog } = setup();
    catalog.resolveType.mockResolvedValue({
      id: 'type',
      code: 'task.default',
      name: 'Стандартный',
      category: 'task',
      workflowId: 'wf',
      creationForm: {
        fields: [{ key: 'deadline', label: null, required: false, preset: null }],
        chips: [],
        locks: [{ key: 'deadline', editors: 'owners' }],
      },
    });
    await service.create(USER, { title: 'Т' } as never);
    const data = repo.create.mock.calls[0]![0] as {
      fieldLocks: Record<string, { editors: string; lockedBy: string; source: unknown }>;
    };
    expect(data.fieldLocks.deadline).toMatchObject({
      editors: 'owners',
      lockedBy: 'alice',
      source: { kind: 'creation' },
    });
  });
});
