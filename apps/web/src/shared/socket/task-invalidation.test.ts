import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Paginated, TaskListItem } from '@nodus/contracts';

import { isFreshFromMutation, markFreshFromMutation } from '../api/fresh-from-mutation.js';
import { projectsKeys } from '../api/projects-list.js';
import { tasksKeys } from '../api/tasks-keys.js';
import { kanbanColumnKey } from '../lib/board/kanban-column-key.js';
import type { InvalidationTier, KeyBatcher } from './invalidation-batcher.js';
import { pushTaskKeys } from './task-invalidation.js';

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

const page = (...ids: string[]): Paginated<TaskListItem> => ({
  items: ids.map((id) => ({ id }) as TaskListItem),
  nextCursor: null,
});
/** Колонка с продолжением: дальше первой страницы есть догружаемые карточки. */
const longPage = (...ids: string[]): Paginated<TaskListItem> => ({
  ...page(...ids),
  nextCursor: 'c',
});

const PERSONAL = tasksKeys.kanban('personal');
const PROJECT = tasksKeys.kanban('project:p1');

/** Две открытые доски: «Мой план» (колонки m1..m4) и проектная (s1..s4). */
function boardsInCache(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(kanbanColumnKey(PERSONAL, 'm1'), page('t1', 't2'));
  client.setQueryData(kanbanColumnKey(PERSONAL, 'm2'), page('t3'));
  client.setQueryData(kanbanColumnKey(PERSONAL, 'm3'), longPage('t5'));
  client.setQueryData(kanbanColumnKey(PERSONAL, 'm4'), page());
  client.setQueryData(kanbanColumnKey(PROJECT, 's1'), page('t1'));
  client.setQueryData(kanbanColumnKey(PROJECT, 's2'), page());
  client.setQueryData(kanbanColumnKey(PROJECT, 's3'), page('t4'));
  client.setQueryData(kanbanColumnKey(PROJECT, 's4'), page());
  return client;
}

const kanbanKeys = (keys: Array<[unknown[], InvalidationTier]>) =>
  keys.filter(([k]) => k[1] === 'kanban').map(([k]) => JSON.stringify(k));

describe('pushTaskKeys (#311, #317)', () => {
  it('эхо своей кнопки: деталь и кнопки не перезапрашиваются (свежие из ответа), доски — да (#378)', () => {
    markFreshFromMutation('t-fresh');
    const { batcher, keys } = recordingBatcher();
    pushTaskKeys(batcher, new QueryClient(), 'task.stage_changed', {
      taskId: 't-fresh',
      fromStageId: 's1',
      toStageId: 's2',
    });
    expect(has(keys, tasksKeys.detail('t-fresh'))).toBe(false);
    expect(has(keys, tasksKeys.transitions('t-fresh'))).toBe(false);
    expect(has(keys, tasksKeys.listPages())).toBe(true);
    // Окно свежести истекло — эхо снова обновляет деталь.
    expect(isFreshFromMutation('t-fresh', Date.now() + 5_000)).toBe(false);
  });

  it('формульная запись перечитывает деталь даже у автора (пересчёт после ответа)', () => {
    const { batcher } = recordingBatcher();
    const client = new QueryClient();
    const cancel = vi.spyOn(client, 'cancelQueries');
    markFreshFromMutation('t-formula');
    pushTaskKeys(batcher, client, 'task.updated', {
      taskId: 't-formula',
      formulaWrite: true,
    });
    // Обычная инвалидация дедупится об in-flight refetch и отдаёт прошлое
    // значение — формульная запись обязана отменить его и перечитать заново.
    expect(cancel).toHaveBeenCalledWith({ queryKey: tasksKeys.detail('t-formula') });
  });

  it('task.relation_changed обновляет список связей своей карточки', () => {
    const { batcher, keys } = recordingBatcher();
    pushTaskKeys(batcher, new QueryClient(), 'task.relation_changed', { taskId: 't1' });
    expect(has(keys, tasksKeys.relations('t1'))).toBe(true);
    expect(has(keys, tasksKeys.detail('t1'))).toBe(true);
  });

  it('прочие события связей не трогают, ветки — через фабрику branchAll', () => {
    const { batcher, keys } = recordingBatcher();
    pushTaskKeys(batcher, new QueryClient(), 'task.updated', { taskId: 't1' });
    expect(has(keys, tasksKeys.relations('t1'))).toBe(false);
    expect(has(keys, tasksKeys.branchAll())).toBe(true);
  });

  it('личные колонки — только доска и каталог', () => {
    const { batcher, keys } = recordingBatcher();
    pushTaskKeys(batcher, new QueryClient(), 'task.personal_stage_created', {});
    expect(keys.map(([k]) => k)).toEqual([
      [...tasksKeys.personalStages()],
      [...tasksKeys.kanbanAll()],
    ]);
  });

  it('агрегаты дерева структуры (#467): перезапрос на события, меняющие узлы', () => {
    for (const type of [
      'task.created',
      'task.updated',
      'task.stage_changed',
      'task.status_changed',
      'task.completed',
      'task.deleted',
      'task.time_logged',
      'task.timer_stopped',
    ]) {
      const { batcher, keys } = recordingBatcher();
      pushTaskKeys(batcher, new QueryClient(), type, { taskId: 't1' });
      expect(has(keys, projectsKeys.structures()), type).toBe(true);
    }
    // Состав участников на агрегаты узлов не влияет — лишнего запроса нет.
    const { batcher, keys } = recordingBatcher();
    pushTaskKeys(batcher, new QueryClient(), 'task.assigned', { taskId: 't1' });
    expect(has(keys, projectsKeys.structures())).toBe(false);
  });
});

describe('pushTaskKeys: точечные колонки досок (#322)', () => {
  it('правка карточки — только колонки, где она лежит; счётчики не трогаются', () => {
    const { batcher, keys } = recordingBatcher();
    pushTaskKeys(batcher, boardsInCache(), 'task.checklist_changed', { taskId: 't1' });
    expect(kanbanKeys(keys).sort()).toEqual(
      [
        JSON.stringify(kanbanColumnKey(PERSONAL, 'm1')),
        JSON.stringify(kanbanColumnKey(PROJECT, 's1')),
      ].sort(),
    );
    expect(has(keys, tasksKeys.personalStages())).toBe(false);
    expect(has(keys, tasksKeys.stages())).toBe(false);
  });

  it('смена стадии — старая и новая колонки (даже без карточки в кэше) + счётчики', () => {
    const { batcher, keys } = recordingBatcher();
    pushTaskKeys(batcher, boardsInCache(), 'task.stage_changed', {
      taskId: 't4',
      fromStageId: 's3',
      toStageId: 's4',
    });
    // «Мой план» карточки в первых страницах не держит — только колонка с
    // продолжением m3 (возможная догрузка).
    expect(kanbanKeys(keys).sort()).toEqual(
      [
        JSON.stringify(kanbanColumnKey(PERSONAL, 'm3')),
        JSON.stringify(kanbanColumnKey(PROJECT, 's3')),
        JSON.stringify(kanbanColumnKey(PROJECT, 's4')),
      ].sort(),
    );
    expect(has(keys, tasksKeys.personalStages())).toBe(true);
  });

  it('перенос в «Моём плане» — колонка-источник по кэшу + колонка назначения', () => {
    const { batcher, keys } = recordingBatcher();
    pushTaskKeys(batcher, boardsInCache(), 'task.personal_stage_changed', {
      taskId: 't3',
      stageId: 'm4',
    });
    expect(kanbanKeys(keys).sort()).toEqual(
      [
        JSON.stringify(kanbanColumnKey(PERSONAL, 'm2')),
        JSON.stringify(kanbanColumnKey(PERSONAL, 'm4')),
      ].sort(),
    );
  });

  it('колонку не вычислить (новая задача, новый участник) — доски целиком', () => {
    for (const type of ['task.created', 'task.participants_changed', 'task.assigned']) {
      const { batcher, keys } = recordingBatcher();
      pushTaskKeys(batcher, boardsInCache(), type, { taskId: 't9' });
      expect(has(keys, tasksKeys.kanbanAll()), type).toBe(true);
    }
  });

  it('карточки нет в первых страницах доски — колонки этой доски с продолжением (догрузки)', () => {
    for (const type of ['task.updated', 'task.deleted', 'task.checklist_changed']) {
      const { batcher, keys } = recordingBatcher();
      // t4 — на проектной доске (s3), на «Моём плане» её нет в первых страницах:
      // там она может прятаться только в догрузке колонки m3.
      pushTaskKeys(batcher, boardsInCache(), type, { taskId: 't4' });
      expect(kanbanKeys(keys).sort(), type).toEqual(
        [
          JSON.stringify(kanbanColumnKey(PERSONAL, 'm3')),
          JSON.stringify(kanbanColumnKey(PROJECT, 's3')),
        ].sort(),
      );
      expect(has(keys, tasksKeys.kanbanAll()), type).toBe(false);
    }
  });

  it('срок изменён — счётчики «просрочено» пересчитываются; заголовок — нет', () => {
    const deadline = recordingBatcher();
    pushTaskKeys(deadline.batcher, boardsInCache(), 'task.updated', {
      taskId: 't1',
      fields: ['deadline'],
    });
    expect(has(deadline.keys, tasksKeys.stages())).toBe(true);

    const title = recordingBatcher();
    pushTaskKeys(title.batcher, boardsInCache(), 'task.updated', {
      taskId: 't1',
      fields: ['title'],
    });
    expect(has(title.keys, tasksKeys.stages())).toBe(false);
  });
});
