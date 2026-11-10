import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { nodeKindsKeys } from '../api/node-kinds.js';
import { projectsKeys } from '../api/projects-list.js';
import { customFieldsKeys } from '../custom-fields/queries.js';
import type { InvalidationTier, KeyBatcher } from './invalidation-batcher.js';
import { pushNodeKindKeys } from './node-kinds-invalidation.js';

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

describe('pushNodeKindKeys (#556, Р10)', () => {
  it('смена вида инвалидирует реестр видов и структуры проектов', () => {
    const { batcher, keys } = recordingBatcher();
    const handled = pushNodeKindKeys(
      batcher,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      'project.node_kind_changed',
    );
    expect(handled).toBe(true);
    expect(has(keys, nodeKindsKeys.all)).toBe(true);
    expect(has(keys, projectsKeys.structures())).toBe(true);
    expect(has(keys, customFieldsKeys.all)).toBe(true);
  });

  it('смена типа проекта инвалидирует типы и реестр атрибутов (#631)', () => {
    const { batcher, keys } = recordingBatcher();
    const handled = pushNodeKindKeys(
      batcher,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      'project.type_changed',
    );
    expect(handled).toBe(true);
    expect(has(keys, projectsKeys.types())).toBe(true);
    expect(has(keys, customFieldsKeys.all)).toBe(true);
  });

  it('чужие события не обрабатывает', () => {
    const { batcher, keys } = recordingBatcher();
    const handled = pushNodeKindKeys(
      batcher,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      'project.node_updated',
    );
    expect(handled).toBe(false);
    expect(keys).toEqual([]);
  });
});
