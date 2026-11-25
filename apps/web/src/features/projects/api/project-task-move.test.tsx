// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Paginated, TaskListItem, TaskStage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { hasTaskOverlay, resetTaskOverlay } from '../../../shared/api/task-overlay.js';
import { resetRecentInvalidations } from '../../../shared/api/task-invalidate.js';
import { tasksKeys } from '../../../shared/api/tasks-keys.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { useMoveProjectTask } from './projects-api.js';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * Перенос по глобальной оси проектной доски (#1051): одна волна перезапросов.
 * Доска переносит карточку локально (замок), мутация не трогает журнал до
 * ответа; ответ пишется в журнал и оверлей досок.
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

const STAGE_A: TaskStage = {
  id: 's-a',
  name: 'Новая',
  order: 0,
  systemState: 'backlog',
  color: 'neutral',
};
const STAGE_B: TaskStage = {
  id: 's-b',
  name: 'В работе',
  order: 1,
  systemState: 'active',
  color: 'success',
};

const row = (stage: TaskStage, title: string): TaskListItem =>
  ({ id: 't-1', number: 7, title, stage }) as TaskListItem;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(tasksKeys.listPages(), {
    pages: [{ items: [row(STAGE_A, 'Задача')], nextCursor: null }],
    pageParams: [null],
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => useMoveProjectTask(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  const inJournal = () =>
    (client.getQueryData(tasksKeys.listPages()) as InfiniteData<Paginated<TaskListItem>>).pages[0]!
      .items[0]!;
  const rounds = (key: readonly unknown[]) =>
    invalidate.mock.calls
      .map((c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey))
      .filter((k) => k === JSON.stringify(key)).length;
  return { hook, inJournal, rounds };
}

describe('useMoveProjectTask: одна волна перезапросов (#1051)', () => {
  it('до ответа журнал не тронут; ответ пишется в журнал и оверлей досок — один раунд', async () => {
    let release!: () => void;
    server.use(
      http.patch('/api/v1/tasks/t-1', async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(row(STAGE_B, 'Ответ сервера'));
      }),
    );
    const { hook, inJournal, rounds } = setup();

    act(() => {
      hook.result.current.mutate({ taskId: 't-1', stageId: STAGE_B.id, index: 0 });
    });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    // Карточку перенесла сама доска (локальный борд под замком); журнал ждёт ответа.
    expect(inJournal()?.stage.id).toBe(STAGE_A.id);
    expect(hasTaskOverlay('t-1')).toBe(false);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(inJournal()).toMatchObject({ title: 'Ответ сервера', stage: { id: STAGE_B.id } });
    expect(hasTaskOverlay('t-1')).toBe(true);

    // Один раунд: деталь, кнопки и агрегаты узлов (стадия кормит прогресс) — по разу;
    // доски, журнал и ветки — только пометка, их догоняет эхо.
    expect(rounds(tasksKeys.detail('t-1'))).toBe(1);
    expect(rounds(tasksKeys.transitions('t-1'))).toBe(1);
    expect(rounds(tasksKeys.actions('t-1'))).toBe(1);
    expect(rounds(projectsKeys.structures())).toBe(1);
    expect(rounds(tasksKeys.kanbanAll())).toBe(1);
    expect(rounds(tasksKeys.listPages())).toBe(1);
    expect(rounds(tasksKeys.branchAll())).toBe(1);
  });

  it('отказ сервера: тост, журнал и оверлей не тронуты', async () => {
    server.use(
      http.patch('/api/v1/tasks/t-1', () =>
        HttpResponse.json({ code: 'TASK_TRANSITION_DENIED', message: 'no' }, { status: 403 }),
      ),
    );
    const { hook, inJournal } = setup();

    act(() => {
      hook.result.current.mutate({ taskId: 't-1', stageId: STAGE_B.id, index: 0 });
    });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));

    expect(inJournal()?.stage.id).toBe(STAGE_A.id);
    expect(hasTaskOverlay('t-1')).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(ui.tasks.stageMoveError);
  });
});
