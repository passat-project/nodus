// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskListItem } from '@nodus/contracts';

import {
  boardMoveSettledAt,
  invalidateNow,
  markBoardMoveSettled,
  wasInvalidatedRecently,
} from './api/task-invalidate.js';
import { publishTaskItem, taskOverlayItem } from './api/task-overlay.js';
import { tasksKeys } from './api/tasks-keys.js';
import { useAuthStore } from './auth-store.js';
import { startChatDraftsSession } from './chat/chat-drafts-session.js';
import { useChatDrafts } from './chat/chat-drafts.js';
import { queryClient } from './lib/query-client.js';
import { resetSessionState } from './session-reset.js';
import { useListToolbar } from './views/use-list-toolbar.js';
import { listFiltersStorageKey } from './views/list-filters-storage.js';

/**
 * AUD-005: смена пользователя в одной вкладке. Кэш запросов, черновики и
 * сохранённые фильтры принадлежат сессии, а не браузеру: любой переход
 * «пользователь → аноним» и «A → B» их очищает.
 */
const USER_A = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a@nodus.by',
  displayName: 'Пользователь A',
  permissions: [] as string[],
};
const USER_B = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'b@nodus.by',
  displayName: 'Пользователь B',
  permissions: [] as string[],
};
const DRAFT_KEY = 'conversation:11111111-1111-4111-8111-aaaaaaaaaaaa';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  // Оболочка запускает подписку на смену пользователя; в тесте — явно.
  startChatDraftsSession();
  localStorage.clear();
  queryClient.clear();
  useChatDrafts.setState({ drafts: {} });
  useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null });
  vi.restoreAllMocks();
});

describe('AUD-005: сброс сессии', () => {
  it('выход очищает кэш запросов и стор черновиков, а не только auth-стор', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER_A });
    queryClient.setQueryData(['letters', 'list'], { items: [{ id: 'letter-a' }] });
    useChatDrafts.getState().setText(DRAFT_KEY, 'секрет A');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useChatDrafts.getState().drafts).toEqual({});
  });

  it('ключ черновиков содержит id пользователя', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER_A });
    useChatDrafts.getState().setText(DRAFT_KEY, 'черновик A');

    expect(localStorage.getItem(`nodus-chat-drafts-v1:${USER_A.id}`)).not.toBeNull();
    // Общий ключ прошлой формы больше не пишется.
    expect(localStorage.getItem('nodus-chat-drafts-v1')).toBeNull();
  });

  it('черновик A не виден B, после повторного входа A — на месте', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER_A });
    useChatDrafts.getState().setText(DRAFT_KEY, 'секрет A');

    useAuthStore.setState({ status: 'authenticated', accessToken: 't2', user: USER_B });
    await vi.waitFor(() => expect(useChatDrafts.getState().drafts[DRAFT_KEY]).toBeUndefined());

    useAuthStore.setState({ status: 'authenticated', accessToken: 't3', user: USER_A });
    await vi.waitFor(() =>
      expect(useChatDrafts.getState().drafts[DRAFT_KEY]?.text).toBe('секрет A'),
    );
  });

  it('refresh чужого аккаунта сбрасывает кэш и черновики вкладки', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'token-a', user: USER_A });
    queryClient.setQueryData(['tasks', 'list'], { items: [{ id: 'task-a' }] });
    useChatDrafts.getState().setText(DRAFT_KEY, 'секрет A');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, { accessToken: 'token-b', expiresIn: 900, userId: USER_B.id }),
      ),
    );

    await expect(useAuthStore.getState().tryRefresh()).resolves.toBe(false);

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useChatDrafts.getState().drafts).toEqual({});
  });

  it('сохранённые фильтры A не читаются под B и сбрасываются точкой сессии', () => {
    localStorage.setItem(
      listFiltersStorageKey(USER_A.id, 'tasks.list'),
      JSON.stringify({ filters: { state: 'open' }, presets: [] }),
    );

    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER_A });
    const asA = renderHook(() => useListToolbar('tasks.list'));
    expect(asA.result.current.filters).toEqual({ state: 'open' });
    asA.unmount();

    useAuthStore.setState({ status: 'authenticated', accessToken: 't2', user: USER_B });
    const asB = renderHook(() => useListToolbar('tasks.list'));
    expect(asB.result.current.filters).toEqual({});
    act(() => asB.result.current.setFilter('state', 'done'));
    expect(localStorage.getItem(listFiltersStorageKey(USER_B.id, 'tasks.list'))).not.toBeNull();
    asB.unmount();

    resetSessionState(USER_A.id);
    expect(localStorage.getItem(listFiltersStorageKey(USER_A.id, 'tasks.list'))).toBeNull();
    // Ключ B не тронут.
    expect(localStorage.getItem(listFiltersStorageKey(USER_B.id, 'tasks.list'))).not.toBeNull();
  });

  it('выход стирает оверлей досок и метки недавних инвалидаций (#1051)', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER_A });
    publishTaskItem(
      { id: 'task-a', number: 1, title: 'неподтверждённое имя A' } as TaskListItem,
      true,
    );
    markBoardMoveSettled();
    void invalidateNow(queryClient, tasksKeys.detail('task-a'));
    expect(wasInvalidatedRecently(tasksKeys.detail('task-a'))).toBe(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await useAuthStore.getState().logout();

    expect(taskOverlayItem('task-a')).toBeUndefined();
    expect(boardMoveSettledAt()).toBe(0);
    expect(wasInvalidatedRecently(tasksKeys.detail('task-a'))).toBe(false);
  });
});
