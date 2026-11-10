// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  });
});
