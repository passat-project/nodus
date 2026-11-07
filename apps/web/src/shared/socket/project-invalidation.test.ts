import { describe, expect, it, vi } from 'vitest';

import { tasksKeys } from '../api/tasks-keys.js';
import type { KeyBatcher } from './invalidation-batcher.js';
import { pushProjectKeys } from './project-invalidation.js';

function batcherOf(): { batcher: KeyBatcher; keys: string[] } {
  const keys: string[] = [];
  const batcher: KeyBatcher = {
    push: (key) => {
      keys.push(JSON.stringify(key));
    },
    flush: vi.fn(),
    dispose: vi.fn(),
  };
  return { batcher, keys };
}

describe('pushProjectKeys — адресные события проекта (#646/#632)', () => {
  it('правка атрибутов папки перечитывает списки задач и канбан (формулы наследников)', () => {
    const { batcher, keys } = batcherOf();
    const handled = pushProjectKeys(batcher, 'project.node_updated', {
      projectId: 'p1',
      nodeId: 'n1',
      fields: ['cf.f1', 'name'],
    });
    expect(handled).toBe(true);
    expect(keys).toContain(JSON.stringify(tasksKeys.listPages()));
    expect(keys).toContain(JSON.stringify(tasksKeys.kanbanAll()));
  });

  it('правка без атрибутов списки задач не трогает', () => {
    const { batcher, keys } = batcherOf();
    pushProjectKeys(batcher, 'project.node_updated', {
      projectId: 'p1',
      nodeId: 'n1',
      fields: ['name'],
    });
    expect(keys).not.toContain(JSON.stringify(tasksKeys.listPages()));
  });

  it('project.updated с атрибутом тоже обновляет списки (формулы на проект)', () => {
    const { batcher, keys } = batcherOf();
    pushProjectKeys(batcher, 'project.updated', {
      projectId: 'p1',
      fields: ['cf.f2'],
    });
    expect(keys).toContain(JSON.stringify(tasksKeys.listPages()));
    expect(keys).toContain(JSON.stringify(tasksKeys.kanbanAll()));
  });

  it('чужое событие не обрабатывается', () => {
    const { batcher, keys } = batcherOf();
    expect(pushProjectKeys(batcher, 'project.node_moved', { projectId: 'p1' })).toBe(false);
    expect(keys).toHaveLength(0);
  });
});
