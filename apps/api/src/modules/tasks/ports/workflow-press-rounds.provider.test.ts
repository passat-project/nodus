import { describe, expect, it, vi } from 'vitest';

import { WorkflowPressRoundsProvider } from './workflow-press-rounds.provider.js';

describe('WorkflowPressRoundsProvider (#434)', () => {
  it('открытые кнопки маршрута — через репозиторий отметок', async () => {
    const press = { openTransitionIdsForWorkflow: vi.fn(async () => ['t1', 't2']) };
    const provider = new WorkflowPressRoundsProvider(press as never);
    await expect(provider.openTransitionIds('wf-1')).resolves.toEqual(new Set(['t1', 't2']));
    expect(press.openTransitionIdsForWorkflow).toHaveBeenCalledWith('wf-1', undefined);
  });
});
