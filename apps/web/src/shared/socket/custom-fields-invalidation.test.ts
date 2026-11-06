import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { nodeKindsKeys } from '../api/node-kinds.js';
import { projectsKeys } from '../api/projects-list.js';
import { tasksKeys } from '../api/tasks-keys.js';
import { customFieldsKeys } from '../custom-fields/queries.js';
import { dictionariesKeys } from '../dictionaries/keys.js';
import type { InvalidationTier, KeyBatcher } from './invalidation-batcher.js';
import { pushCustomFieldKeys } from './custom-fields-invalidation.js';

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

describe('pushCustomFieldKeys (#431, ADR-0029)', () => {
  it('смена определения поля инвалидирует реестр, справочники и карточки', () => {
    const { batcher, keys } = recordingBatcher();
    const handled = pushCustomFieldKeys(
      batcher,
      new QueryClient(),
      'custom_field.definition_changed',
    );
    expect(handled).toBe(true);
    expect(has(keys, customFieldsKeys.all)).toBe(true);
    expect(has(keys, dictionariesKeys.all)).toBe(true);
    expect(has(keys, projectsKeys.types())).toBe(true);
    expect(has(keys, nodeKindsKeys.all)).toBe(true);
    expect(has(keys, tasksKeys.detailsAll())).toBe(true);
    expect(has(keys, tasksKeys.listPages())).toBe(true);
  });

  it('события справочников — тоже каталожные', () => {
    const { batcher, keys } = recordingBatcher();
    const handled = pushCustomFieldKeys(batcher, new QueryClient(), 'dictionary.item_updated');
    expect(handled).toBe(true);
    expect(has(keys, dictionariesKeys.all)).toBe(true);
  });

  it('чужие события не обрабатывает', () => {
    const { batcher, keys } = recordingBatcher();
    const handled = pushCustomFieldKeys(batcher, new QueryClient(), 'task.updated');
    expect(handled).toBe(false);
    expect(keys).toEqual([]);
  });
});
