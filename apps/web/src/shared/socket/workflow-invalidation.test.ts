import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { automationKeys } from '../api/automation-keys.js';
import { tasksKeys } from '../api/tasks-keys.js';
import { workflowKeys } from '../workflow/workflow-api.js';
import type { InvalidationTier, KeyBatcher } from './invalidation-batcher.js';
import { pushWorkflowKeys } from './workflow-invalidation.js';

function recordingBatcher(): { batcher: KeyBatcher; keys: Array<[unknown[], InvalidationTier]> } {
  const keys: Array<[unknown[], InvalidationTier]> = [];
  return {
    keys,
    batcher: {
      push: (key, tier) => keys.push([[...key], tier]),
      flush: () => {},
      dispose: () => {},
    },
  };
}

const has = (keys: Array<[unknown[], InvalidationTier]>, key: readonly unknown[]): boolean =>
  keys.some(([k]) => JSON.stringify(k) === JSON.stringify(key));

describe('pushWorkflowKeys (#428, ADR-0024)', () => {
  it('каталожные события инвалидируют типы, стадии, маршруты и переходы задач', () => {
    const { batcher, keys } = recordingBatcher();
    const handled = pushWorkflowKeys(
      batcher,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      'workflow.published',
      {
        workflowId: 'w1',
      },
    );
    expect(handled).toBe(true);
    expect(has(keys, automationKeys.all)).toBe(true);
    expect(has(keys, workflowKeys.all)).toBe(true);
    expect(has(keys, tasksKeys.stages())).toBe(true);
    expect(has(keys, [tasksKeys.all[0], 'transitions'])).toBe(true);
    expect(has(keys, tasksKeys.listPages())).toBe(true);
  });

  it('расстановка холста — только документ этого маршрута', () => {
    const { batcher, keys } = recordingBatcher();
    pushWorkflowKeys(
      batcher,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      'workflow.layout_changed',
      { workflowId: 'w1' },
    );
    expect(keys).toEqual([[workflowKeys.detail('w1'), 'list']]);
  });

  it('чужие события не обрабатывает (не workflow.*)', () => {
    const { batcher, keys } = recordingBatcher();
    const handled = pushWorkflowKeys(
      batcher,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      'task.stage_changed',
      {
        taskId: 't1',
      },
    );
    expect(handled).toBe(false);
    expect(keys).toEqual([]);
  });
});
