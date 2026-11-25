// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChecklistItem, TaskDetail, TaskListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import {
  applyTaskOverlay,
  hasTaskOverlay,
  resetTaskOverlay,
} from '../../../shared/api/task-overlay.js';
import { resetRecentInvalidations } from '../../../shared/api/task-invalidate.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import {
  useAddChecklistItem,
  useDeleteChecklistItem,
  useToggleChecklistItem,
} from './checklist-api.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * Пункты чек-листа карточки (#1051): бейдж «n/m» на карточке доски — оверлеем.
 * Сервер отвечает ПУНКТОМ, а не строкой задачи: без оверлея бейдж был виден
 * только после перезапроса всех колонок.
 */

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
  resetTaskOverlay();
  resetRecentInvalidations();
});
afterAll(() => server.close());

const ITEM: ChecklistItem = { id: 'c-1', text: 'Пункт', done: false };
const detailOf = (checklist: ChecklistItem[]): TaskDetail =>
  ({
    id: 't-1',
    checklist,
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((i) => i.done).length,
  }) as TaskDetail;

const CARD = {
  id: 't-1',
  number: 1,
  title: 'Задача',
  checklistTotal: 1,
  checklistDone: 0,
} as TaskListItem;
/** Бейдж «n/m» на карточке доски. */
const badge = () => {
  const face = applyTaskOverlay([CARD])[0]!;
  return `${face.checklistDone}/${face.checklistTotal}`;
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(tasksKeys.detail('t-1'), detailOf([ITEM]));
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, wrapper };
}

const toggle = (env: ReturnType<typeof setup>) =>
  renderHook(() => useToggleChecklistItem('t-1'), { wrapper: env.wrapper });
const add = (env: ReturnType<typeof setup>) =>
  renderHook(() => useAddChecklistItem('t-1'), { wrapper: env.wrapper });
const remove = (env: ReturnType<typeof setup>) =>
  renderHook(() => useDeleteChecklistItem('t-1'), { wrapper: env.wrapper });

describe('чек-лист: бейдж на доске — оверлеем (#1051)', () => {
  it('отметка пункта: бейдж на доске меняется до ответа и держится после', async () => {
    let release!: () => void;
    server.use(
      http.patch('/api/v1/tasks/t-1/checklist/c-1', async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({ ...ITEM, done: true });
      }),
    );
    const hook = toggle(setup());

    act(() => {
      hook.result.current.mutate({ itemId: 'c-1', done: true });
    });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(badge()).toBe('1/1');

    await act(async () => {
      release();
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(badge()).toBe('1/1');
    expect(hasTaskOverlay('t-1')).toBe(true);
  });

  it('новый пункт: счётчик растёт до ответа; после — итоговое значение сервера', async () => {
    server.use(
      http.post('/api/v1/tasks/t-1/checklist', () =>
        HttpResponse.json({ id: 'c-2', text: 'Новый', done: false }),
      ),
    );
    const hook = add(setup());

    act(() => {
      hook.result.current.mutate({ text: 'Новый', tempId: 'temp-2' });
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(badge()).toBe('0/2');
  });

  it('удаление пункта: счётчик уменьшается', async () => {
    server.use(http.delete('/api/v1/tasks/t-1/checklist/c-1', () => HttpResponse.json({})));
    const hook = remove(setup());

    act(() => {
      hook.result.current.mutate({ itemId: 'c-1' });
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(badge()).toBe('0/0');
  });

  it('отказ сервера: бейдж возвращается к прежнему значению', async () => {
    server.use(
      http.patch('/api/v1/tasks/t-1/checklist/c-1', () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'no' }, { status: 500 }),
      ),
    );
    const hook = toggle(setup());

    act(() => {
      hook.result.current.mutate({ itemId: 'c-1', done: true });
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));

    expect(badge()).toBe('0/1');
    expect(hasTaskOverlay('t-1')).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(ui.common.saveError);
  });

  it('доски и журнал перезапросом не грузятся: их догоняет эхо события', async () => {
    server.use(
      http.patch('/api/v1/tasks/t-1/checklist/c-1', () =>
        HttpResponse.json({ ...ITEM, done: true }),
      ),
    );
    const env = setup();
    const hook = toggle(env);

    act(() => {
      hook.result.current.mutate({ itemId: 'c-1', done: true });
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    const staleOnly = env.invalidate.mock.calls
      .filter((c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey).includes('kanban'))
      .every((c) => (c[0] as { refetchType?: string }).refetchType === 'none');
    expect(staleOnly).toBe(true);
  });
});
