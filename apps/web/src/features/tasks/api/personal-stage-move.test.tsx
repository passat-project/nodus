// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Paginated, TaskDetail, TaskListItem } from '@nodus/contracts';
import { toast } from 'sonner';

import { hasTaskOverlay, resetTaskOverlay } from '../../../shared/api/task-overlay.js';
import { resetRecentInvalidations } from '../../../shared/api/task-invalidate.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { useUpdateTaskPersonalStage } from './personal-stages-api.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * Перенос по личной оси «Мой план» (#1051): одна волна перезапросов. Доска
 * переносит карточку локально (замок), мутация отвечает за журнал и деталь —
 * до ответа сервера; ответ пишется во все витрины строки.
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

const FROM = '00000000-0000-4000-8000-0000000000b1';
const TO = '00000000-0000-4000-8000-0000000000b2';

const row = (personalStageId: string, title: string): TaskListItem =>
  ({ id: 't-1', number: 7, title, personalStageId }) as TaskListItem;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(tasksKeys.listPages(), {
    pages: [{ items: [row(FROM, 'Задача')], nextCursor: null }],
    pageParams: [null],
  });
  client.setQueryData<TaskDetail>(tasksKeys.detail('t-1'), {
    id: 't-1',
    personalStageId: FROM,
    title: 'Задача',
  } as TaskDetail);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => useUpdateTaskPersonalStage(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  const inJournal = () =>
    (client.getQueryData(tasksKeys.listPages()) as InfiniteData<Paginated<TaskListItem>>).pages[0]!
      .items[0]!;
  const detail = () => client.getQueryData<TaskDetail>(tasksKeys.detail('t-1'));
  const invalidated = () =>
    invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey));
  const rounds = (key: readonly unknown[]) =>
    invalidated().filter((k) => k === JSON.stringify(key)).length;
  return { hook, inJournal, detail, invalidate, invalidated, rounds };
}

const move = (hook: ReturnType<typeof setup>['hook']) =>
  act(async () => {
    hook.result.current.mutate({ taskId: 't-1', personalStageId: TO, index: 0 });
  });

describe('useUpdateTaskPersonalStage: одна волна перезапросов (#1051)', () => {
  it('до ответа журнал и деталь показывают новую личную колонку; ответ — во все витрины', async () => {
    let release!: () => void;
    server.use(
      http.patch('/api/v1/tasks/t-1', async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(row(TO, 'Ответ сервера'));
      }),
    );
    const { hook, inJournal, detail, invalidate, invalidated, rounds } = setup();

    await move(hook);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(inJournal()?.personalStageId).toBe(TO);
    expect(detail()?.personalStageId).toBe(TO);
    // Доску переносит сама (локальный борд под замком) — оверлея до ответа нет.
    expect(hasTaskOverlay('t-1')).toBe(false);
    invalidate.mockClear();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(inJournal()).toMatchObject({ personalStageId: TO, title: 'Ответ сервера' });
    expect(hasTaskOverlay('t-1')).toBe(true);

    // Один раунд: точечные ключи — по одному разу, доски и ветки — только пометка.
    expect(rounds(tasksKeys.detail('t-1'))).toBe(1);
    expect(rounds(tasksKeys.listPages())).toBe(1);
    expect(rounds(tasksKeys.personalStages())).toBe(1);
    expect(rounds(tasksKeys.kanbanAll())).toBe(1);
    expect(rounds(tasksKeys.branchAll())).toBe(1);
    // Личный перенос агрегаты узлов структуры не меняет.
    expect(invalidated().some((k) => k.startsWith('["projects"]'))).toBe(false);
  });

  it('отказ сервера: журнал и деталь возвращаются к прежней колонке, тост с причиной', async () => {
    server.use(
      http.patch('/api/v1/tasks/t-1', () =>
        HttpResponse.json({ code: 'TASK_TRANSITION_DENIED', message: 'no' }, { status: 403 }),
      ),
    );
    const { hook, inJournal, detail } = setup();

    await move(hook);
    await waitFor(() => expect(hook.result.current.isError).toBe(true));

    expect(inJournal()?.personalStageId).toBe(FROM);
    expect(detail()?.personalStageId).toBe(FROM);
    expect(hasTaskOverlay('t-1')).toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
