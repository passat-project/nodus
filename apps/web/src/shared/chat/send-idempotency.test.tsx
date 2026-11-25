// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { chatKeys } from './chat-keys.js';

import { useSendChatMessage } from './send-message.js';

/**
 * Идемпотентность отправки (#48): ключ = temp id оптимистичной записи.
 * Повтор ТОГО ЖЕ логического сообщения (двойной клик/ретрай после потери
 * ответа) шлёт ОДИНАКОВЫЙ Idempotency-Key — сервер сведёт повторы в одну
 * строку (client_message_id), а не задвоит. Гербетика: env-флаг выключен —
 * тесты живут в «живой» ветке (без мок-таймера read-receipt).
 */

const CONV = '11111111-1111-4111-8111-111111111111';

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function stubPostFetch(keys: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (init?.method === 'POST') keys.push(headers['Idempotency-Key'] ?? '');
      return new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubEnv('VITE_API_MOCK', 'false');
});

afterEach(cleanup);

describe('useSendChatMessage — идемпотентность отправки (#48)', () => {
  it('две отправки с одним temp id → одинаковый Idempotency-Key', async () => {
    const keys: string[] = [];
    stubPostFetch(keys);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendChatMessage(CONV), {
      wrapper: makeWrapper(client),
    });

    // Двойной клик / ретрай: то же логическое сообщение, тот же temp id.
    await act(async () => {
      result.current.mutate({ text: 'одно и то же', tempId: 'temp-one' });
    });
    await waitFor(() => expect(keys).toHaveLength(1));
    await act(async () => {
      result.current.mutate({ text: 'одно и то же', tempId: 'temp-one' });
    });
    await waitFor(() => expect(keys).toHaveLength(2));

    expect(keys[0]).toBe('temp-one');
    expect(keys[1]).toBe('temp-one');
    // Гасим мутацию до teardown: иначе её notify прилетает в уже убранный jsdom
    // (ReferenceError: window is not defined) и красит весь прогон (#627).
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('mutate без явного temp id генерирует ключ сам: разные сообщения — разные ключи', async () => {
    const keys: string[] = [];
    stubPostFetch(keys);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendChatMessage(CONV), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ text: 'первое' });
    });
    await waitFor(() => expect(keys).toHaveLength(1));
    await act(async () => {
      result.current.mutate({ text: 'второе' });
    });
    await waitFor(() => expect(keys).toHaveLength(2));

    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});

/** Темп несёт аватар ТЕКУЩЕГО пользователя из кэша справочника (#1021):
 *  раньше avatarUrl в темпе был всегда null — аватар «мигал» до ответа
 *  сервера (инициалы → фото). Кэш справочника не загружен (холодный вход) —
 *  как раньше, null. */
describe('useSendChatMessage — аватар темпа из справочника (#1021)', () => {
  const ME = '11111111-1111-4111-8111-111111111111';

  /** POST-заглушка с задержкой: темп живёт в кэше до ответа — успеваем
   *  прочитать его из кэша waitFor'ом, не гоняясь за settlement. */
  function stubDelayedPost(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
  }

  async function tempInCache(
    client: QueryClient,
    match: (m: ChatMessage) => boolean,
  ): Promise<ChatMessage | undefined> {
    let found: ChatMessage | undefined;
    await waitFor(() => {
      const cached = client.getQueryData<{ items: ChatMessage[] }>(chatKeys.messages(CONV));
      found = cached?.items.find((m) => m.seq === 0);
      expect(found && match(found)).toBe(true);
    });
    return found;
  }

  it('аватар текущего пользователя попадает в автор темпа', async () => {
    stubDelayedPost();
    const { useAuthStore } = await import('../auth-store.js');
    const { usersListKey } = await import('../api/users-list.js');
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'test',
      user: { id: ME, email: 'me@nodus.by', displayName: 'Я Сам', permissions: [] },
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(usersListKey, {
      items: [{ id: ME, avatarUrl: '/avatars/me.png' }],
      nextCursor: null,
    });

    const { result } = renderHook(() => useSendChatMessage(CONV), {
      wrapper: makeWrapper(client),
    });
    act(() => {
      result.current.mutate({ text: 'привет' });
    });

    const temp = await tempInCache(client, (m) => m.author.avatarUrl === '/avatars/me.png');
    expect(temp?.author.id).toBe(ME);
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('кэш справочника пуст (холодный вход) — avatarUrl null, как раньше', async () => {
    stubDelayedPost();
    const { useAuthStore } = await import('../auth-store.js');
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'test',
      user: { id: ME, email: 'me@nodus.by', displayName: 'Я Сам', permissions: [] },
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSendChatMessage(CONV), {
      wrapper: makeWrapper(client),
    });
    act(() => {
      result.current.mutate({ text: 'привет' });
    });

    const temp = await tempInCache(client, (m) => m.author.avatarUrl === null);
    expect(temp?.author.id).toBe(ME);
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
