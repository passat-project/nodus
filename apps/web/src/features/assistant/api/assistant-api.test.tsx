// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessageList, AssistantSession } from '@nodus/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useAssistantStore } from '../model/assistant-store.js';
import {
  assistantKeys,
  stopRunStream,
  useAssistantMessages,
  useAssistantSessions,
  useCancelAssistantRun,
  useCreateAssistantSession,
  useRenameAssistantSession,
  useSendAssistantMessage,
} from './assistant-api.js';

/**
 * Слой данных ассистента (#893, #896): хуки запросов/мутаций и SSE-поток
 * прогона. Поток — сердце живого ответа: дельты, строки инструментов,
 * финал, восстановление по `Last-Event-ID` и «Стоп», который не превращает
 * остановленный прогон в ошибку.
 */

const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';

const session: AssistantSession = {
  id: SESSION_ID,
  title: 'Мои задачи',
  archived: false,
  createdAt: '2026-11-17T10:00:00.000Z',
  updatedAt: '2026-11-17T10:00:00.000Z',
  lastMessageAt: null,
  messageCount: 0,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** SSE-ответ из готовых кадров (`id/event/data` + пустая строка). */
function sse(frames: string[], status = 200): Response {
  const body = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

function frame(seq: number, type: string, data: Record<string, unknown>): string {
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ seq, type, ...data })}\n\n`;
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  useAssistantStore.setState({
    open: false,
    activeId: null,
    pending: null,
    live: null,
  });
});

afterEach(() => {
  stopRunStream();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useAssistantSessions / useAssistantMessages (#893)', () => {
  it('читает диалоги и историю, история без сессии не грузится', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages')) {
        return json({ items: [], nextCursor: null } satisfies AssistantMessageList);
      }
      return json({ items: [session], nextCursor: null });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = client();

    const sessions = renderHook(() => useAssistantSessions(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(sessions.result.current.data?.items).toHaveLength(1));

    const idle = renderHook(() => useAssistantMessages(null), { wrapper: wrapper(queryClient) });
    expect(idle.result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/sessions/null/messages'),
      expect.anything(),
    );

    const history = renderHook(() => useAssistantMessages(SESSION_ID), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(history.result.current.data?.items).toEqual([]));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/assistant/sessions/${SESSION_ID}/messages`,
      expect.anything(),
    );
  });
});

describe('мутации сессий (#893)', () => {
  it('создание ставит новый диалог первым в кэш', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ ...session, title: 'Новый диалог' })),
    );
    const queryClient = client();
    queryClient.setQueryData(assistantKeys.sessions(), {
      items: [{ ...session, id: 'старый' }],
      nextCursor: null,
    });
    const { result } = renderHook(() => useCreateAssistantSession(), {
      wrapper: wrapper(queryClient),
    });
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const cached = queryClient.getQueryData<{ items: AssistantSession[] }>(
      assistantKeys.sessions(),
    );
    expect(cached?.items[0]!.title).toBe('Новый диалог');
    expect(cached?.items).toHaveLength(2);
  });

  it('переименование/архивация отправляет только заданные поля', async () => {
    const fetchMock = vi.fn(async () => json(session));
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRenameAssistantSession(), {
      wrapper: wrapper(queryClient),
    });

    act(() => result.current.mutate({ id: SESSION_ID, archived: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/v1/assistant/sessions/${SESSION_ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ archived: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: assistantKeys.sessions() });
  });

  it('отмена прогона — POST на cancel', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useCancelAssistantRun(), { wrapper: wrapper(client()) });
    act(() => result.current.mutate(RUN_ID));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/v1/assistant/runs/${RUN_ID}/cancel`);
    expect(init.method).toBe('POST');
  });
});

describe('useSendAssistantMessage: оптимистичный вопрос (I4, #893)', () => {
  it('вопрос встаёт в ленту ДО ответа сервера, затем появляется live-буфер', async () => {
    let resolvePost!: (response: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/stream')) {
        return sse([frame(1, 'run.completed', { inputTokens: 1, outputTokens: 2 })]);
      }
      return new Promise<Response>((resolve) => {
        resolvePost = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = client();
    queryClient.setQueryData(assistantKeys.messages(SESSION_ID), {
      items: [],
      nextCursor: null,
    });
    const { result } = renderHook(() => useSendAssistantMessage(), {
      wrapper: wrapper(queryClient),
    });

    act(() => result.current.mutate({ sessionId: SESSION_ID, text: 'Какие задачи?' }));

    // Сервер ещё не ответил — пузырь сотрудника уже в кэше.
    await waitFor(() => {
      const cached = queryClient.getQueryData<AssistantMessageList>(
        assistantKeys.messages(SESSION_ID),
      );
      expect(cached?.items).toHaveLength(1);
      expect(cached?.items[0]).toMatchObject({ role: 'user', text: 'Какие задачи?' });
      expect(cached?.items[0]!.id.startsWith('pending-')).toBe(true);
    });

    resolvePost(json({ runId: RUN_ID, messageId: MESSAGE_ID }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useAssistantStore.getState().live).toMatchObject({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'Какие задачи?',
      userMessageId: MESSAGE_ID,
    });
    await waitFor(() => expect(useAssistantStore.getState().live?.status).toBe('done'));
  });

  it('ошибка отправки откатывает ленту к снимку', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'INTERNAL_ERROR', message: 'Сбой' }, 500)),
    );
    const queryClient = client();
    const snapshot: AssistantMessageList = { items: [], nextCursor: null };
    queryClient.setQueryData(assistantKeys.messages(SESSION_ID), snapshot);
    const { result } = renderHook(() => useSendAssistantMessage(), {
      wrapper: wrapper(queryClient),
    });
    act(() => result.current.mutate({ sessionId: SESSION_ID, text: 'Вопрос' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<AssistantMessageList>(assistantKeys.messages(SESSION_ID)),
    ).toEqual(snapshot);
  });

  it('ошибка в новой сессии (кэша не было) не оставляет пустой кэш', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'VALIDATION_FAILED', message: 'Нет' }, 400)),
    );
    const queryClient = client();
    const { result } = renderHook(() => useSendAssistantMessage(), {
      wrapper: wrapper(queryClient),
    });
    act(() => result.current.mutate({ sessionId: SESSION_ID, text: 'Вопрос' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<AssistantMessageList>(assistantKeys.messages(SESSION_ID)),
    ).toBeUndefined();
  });
});
