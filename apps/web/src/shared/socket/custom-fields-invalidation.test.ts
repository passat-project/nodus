import { QueryClient } from '@tanstack/react-query';
import type { TaskListItem } from '@nodus/contracts';
import { describe, expect, it } from 'vitest';

import { lettersKeys } from '../api/letters-keys.js';
import { isFreshFromMutation, markFreshFromMutation } from '../api/fresh-from-mutation.js';
import { nodeKindsKeys } from '../api/node-kinds.js';
import { projectsKeys } from '../api/projects-list.js';
import { tasksKeys } from '../api/tasks-keys.js';
import { customFieldsKeys } from '../custom-fields/queries.js';
import { dictionariesKeys } from '../dictionaries/keys.js';
import { kanbanColumnKey } from '../lib/board/kanban-column-key.js';
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

describe('pushCustomFieldKeys: формула ячейки (#632, O4)', () => {
  const TASK_ID = '21000000-0000-4000-8000-000000000001';
  const LETTER_ID = '61000000-0000-4000-8000-000000000001';
  const PROJECT_ID = '41000000-0000-4000-8000-000000000001';
  const NODE_ID = '44000000-0000-4000-8000-000000000001';

  const push = (payload: Record<string, unknown>) => {
    const { batcher, keys } = recordingBatcher();
    const handled = pushCustomFieldKeys(
      batcher,
      new QueryClient(),
      'custom_field.formula_changed',
      payload,
    );
    return { handled, keys };
  };

  it('задача — деталь и страницы журнала (fx и «!» в списках)', () => {
    const { handled, keys } = push({ hostKind: 'task', hostId: TASK_ID, hasError: false });
    expect(handled).toBe(true);
    expect(has(keys, tasksKeys.detail(TASK_ID))).toBe(true);
    expect(has(keys, tasksKeys.listPages())).toBe(true);
    // Каталожные ключи не трогаем: событие адресное, определения не менялись.
    expect(has(keys, customFieldsKeys.all)).toBe(false);
  });

  it('письмо — деталь и списки писем', () => {
    const { handled, keys } = push({ hostKind: 'letter', hostId: LETTER_ID, hasError: true });
    expect(handled).toBe(true);
    expect(has(keys, lettersKeys.detail(LETTER_ID))).toBe(true);
    expect(has(keys, lettersKeys.lists())).toBe(true);
  });

  it('проект — карточка и журнал проектов', () => {
    const { handled, keys } = push({ hostKind: 'project', hostId: PROJECT_ID, hasError: false });
    expect(handled).toBe(true);
    expect(has(keys, projectsKeys.detail(PROJECT_ID))).toBe(true);
    expect(has(keys, projectsKeys.journals())).toBe(true);
  });

  it('папка — деревья структуры префиксом (projectId в событии нет)', () => {
    const { handled, keys } = push({ hostKind: 'node', hostId: NODE_ID, hasError: false });
    expect(handled).toBe(true);
    expect(has(keys, projectsKeys.structures())).toBe(true);
  });

  it('битый/неизвестный адрес — событие наше, инвалидаций нет', () => {
    expect(push({ hostKind: 'task' })).toEqual({ handled: true, keys: [] });
    expect(push({ hostKind: 'registry', hostId: TASK_ID })).toEqual({ handled: true, keys: [] });
  });
});

/**
 * A6-2 (#632): актёр получал эхо своего же сохранения формулы — лишний GET
 * детали (как у task.*, #378). Доски при этом обновляются всегда: бейдж
 * ошибки живёт в `TaskListItem.customFieldFormulas` карточки канбана.
 */
describe('pushCustomFieldKeys: эхо своей мутации и доски (A6-2)', () => {
  const FRESH_TASK = '21000000-0000-4000-8000-0000000000f1';
  const COLD_TASK = '21000000-0000-4000-8000-0000000000f2';
  const LETTER_ID = '61000000-0000-4000-8000-0000000000f3';
  const STAGE_ID = '32000000-0000-4000-8000-000000000001';
  const OTHER_STAGE_ID = '32000000-0000-4000-8000-000000000002';

  /** Кэш доски: две колонки, карточка — только в первой. */
  function boardClient(taskId: string): {
    client: QueryClient;
    holding: unknown[];
    other: unknown[];
  } {
    const client = new QueryClient();
    const board = tasksKeys.kanban('personal');
    const holding = kanbanColumnKey(board, STAGE_ID);
    const other = kanbanColumnKey(board, OTHER_STAGE_ID);
    client.setQueryData(holding, { items: [{ id: taskId } as TaskListItem], nextCursor: null });
    client.setQueryData(other, {
      items: [{ id: '21000000-0000-4000-8000-0000000000ff' } as TaskListItem],
      nextCursor: null,
    });
    return { client, holding: [...holding], other: [...other] };
  }

  const push = (client: QueryClient, payload: Record<string, unknown>) => {
    const { batcher, keys } = recordingBatcher();
    pushCustomFieldKeys(batcher, client, 'custom_field.formula_changed', payload);
    return keys;
  };

  it('своя свежая мутация: деталь всё равно перезапрашивается, колонка — да', () => {
    const { client, holding, other } = boardClient(FRESH_TASK);
    markFreshFromMutation(FRESH_TASK);
    expect(isFreshFromMutation(FRESH_TASK)).toBe(true);
    const keys = push(client, { hostKind: 'task', hostId: FRESH_TASK, hasError: true });
    // Пересчёт зависимых формул идёт ПОСЛЕ ответа мутации: без перезапроса
    // детали карточка показывала старое значение до перезагрузки (регрессия).
    expect(has(keys, tasksKeys.detail(FRESH_TASK))).toBe(true);
    expect(has(keys, tasksKeys.listPages())).toBe(true);
    expect(has(keys, holding)).toBe(true);
    // Колонка без карточки не трогается: событие адресное, стадии не меняются.
    expect(has(keys, other)).toBe(false);
  });

  it('чужая задача: деталь, журнал и колонка с карточкой', () => {
    const { client, holding } = boardClient(COLD_TASK);
    const keys = push(client, { hostKind: 'task', hostId: COLD_TASK, hasError: false });
    expect(has(keys, tasksKeys.detail(COLD_TASK))).toBe(true);
    expect(has(keys, tasksKeys.listPages())).toBe(true);
    expect(has(keys, holding)).toBe(true);
  });

  it('письмо: свежесть мутации деталь не отменяет (эхо — единственный канал)', () => {
    const client = new QueryClient();
    markFreshFromMutation(LETTER_ID);
    const keys = push(client, { hostKind: 'letter', hostId: LETTER_ID, hasError: true });
    expect(has(keys, lettersKeys.detail(LETTER_ID))).toBe(true);
    expect(has(keys, lettersKeys.lists())).toBe(true);
  });
});
