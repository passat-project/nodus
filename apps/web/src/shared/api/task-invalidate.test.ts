import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import { projectsKeys } from './projects-list.js';
import {
  invalidateAfterTaskMutation,
  invalidateAllTasksNow,
  invalidateNow,
  resetRecentInvalidations,
  wasInvalidatedRecently,
} from './task-invalidate.js';
import { tasksKeys } from './tasks-keys.js';

type Invalidate = QueryClient['invalidateQueries'];
type Filters = NonNullable<Parameters<Invalidate>[0]>;

afterEach(() => {
  resetRecentInvalidations(); // метки — память модуля, не кэш
  vi.useRealTimers();
});

describe('invalidateAllTasksNow (#1051): массовая правка — один раунд', () => {
  it('перезапрашивает всё и ставит метку на каждый ключ задач в кэше; чужие модули не задевает', () => {
    const client = new QueryClient();
    const pages = tasksKeys.listPages();
    const board = tasksKeys.kanban('personal');
    client.setQueryData(pages, {});
    client.setQueryData(tasksKeys.detail('t1'), {});
    client.setQueryData(board, {});
    client.setQueryData(projectsKeys.detail('p1'), {});
    const spy = vi.spyOn(client, 'invalidateQueries');

    invalidateAllTasksNow(client);

    // Один вызов префиксом — эхо собственных событий найдёт метку на каждом ключе.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: tasksKeys.all });
    expect(wasInvalidatedRecently(pages)).toBe(true);
    expect(wasInvalidatedRecently(tasksKeys.detail('t1'))).toBe(true);
    expect(wasInvalidatedRecently(board)).toBe(true);
    expect(wasInvalidatedRecently(projectsKeys.detail('p1'))).toBe(false);
  });
});

describe('invalidateAfterTaskMutation (#1051): одна правка — один раунд', () => {
  const collected = (spy: MockInstance<Invalidate>): Filters[] =>
    spy.mock.calls.map(([filters]) => (filters ?? {}) as Filters);

  it('деталь, переходы и действия перезапрашиваются сразу; доски, журнал и ветки — только помечаются', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    invalidateAfterTaskMutation(client, 't1');
    const calls = collected(spy);
    const keys = calls.map((f) => f.queryKey);
    expect(keys).toContainEqual(tasksKeys.detail('t1'));
    expect(keys).toContainEqual(tasksKeys.transitions('t1'));
    expect(keys).toContainEqual(tasksKeys.actions('t1'));
    const staleOnly = (key: readonly unknown[]) =>
      calls.some(
        (f) => JSON.stringify(f.queryKey) === JSON.stringify(key) && f.refetchType === 'none',
      );
    expect(staleOnly(tasksKeys.kanbanAll())).toBe(true);
    expect(staleOnly(tasksKeys.listPages())).toBe(true);
    expect(staleOnly(tasksKeys.branchAll())).toBe(true);
    // Широкие ключи сразу не перезапрашиваются: только точечные (3+ сегмента).
    expect(
      calls.filter((f) => f.refetchType !== 'none').every((f) => (f.queryKey?.length ?? 0) >= 3),
    ).toBe(true);
    // Каталоги стадий и агрегаты узлов правка имени не трогает.
    expect(keys).not.toContainEqual(tasksKeys.stages());
    expect(keys).not.toContainEqual(tasksKeys.personalStages());
    expect(keys).not.toContainEqual(projectsKeys.structures());
  });

  it('срок обновляет каталоги стадий («просрочено»); плановое время и атрибуты — агрегаты узлов (#467)', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    invalidateAfterTaskMutation(client, 't1', {
      deadline: true,
      plannedMinutes: true,
      structure: true,
    });
    const keys = collected(spy).map((f) => f.queryKey);
    expect(keys).toContainEqual(tasksKeys.stages());
    expect(keys).toContainEqual(tasksKeys.personalStages());
    expect(keys).toContainEqual(projectsKeys.structures());
  });

  it('перезапрос своей мутации ставит метку: эхо того же ключа в окне TTL пропускается, позже — проходит', () => {
    vi.useFakeTimers();
    const start = 1_000_000;
    vi.setSystemTime(start);
    const client = new QueryClient();
    vi.spyOn(client, 'invalidateQueries');
    void invalidateNow(client, tasksKeys.detail('t1'));
    expect(wasInvalidatedRecently(tasksKeys.detail('t1'))).toBe(true);
    expect(wasInvalidatedRecently(tasksKeys.detail('t2'))).toBe(false);
    vi.setSystemTime(start + 1_999);
    expect(wasInvalidatedRecently(tasksKeys.detail('t1'))).toBe(true);
    vi.setSystemTime(start + 2_000);
    expect(wasInvalidatedRecently(tasksKeys.detail('t1'))).toBe(false);
  });
});
