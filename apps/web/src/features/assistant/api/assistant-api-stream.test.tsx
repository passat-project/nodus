// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act, renderHook, waitFor } from '@testing-library/react';

import { resetSessionState } from '../../../shared/session-reset.js';
import { useAssistantStore } from '../model/assistant-store.js';
import {
  recoverAssistantRun,
  startRunStream,
  stopRunStream,
  useIsRunActive,
} from './assistant-api.js';

/**
 * Поток прогона ассистента (#893, #896): дельты, строки инструментов, финал,
 * восстановление по `Last-Event-ID`, «Стоп» без превращения остановки в
 * ошибку и подхват после закрытия окна. Хуки запросов/мутаций —
 * `assistant-api.test.tsx`.
 */

const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';

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

describe('startRunStream: поток прогона (#893)', () => {
  it('дельты, инструменты и финал собираются в живой буфер', async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        frame(1, 'run.started', { messageId: MESSAGE_ID, model: 'model-x' }),
        frame(2, 'message.delta', { text: 'У вас ' }),
        frame(3, 'reasoning.delta', { text: 'смотрю задачи' }),
        frame(4, 'tool.started', {
          toolCallId: MESSAGE_ID,
          toolId: 'tasks.list',
          title: 'Задачи: список',
          args: { scope: 'mine' },
        }),
        frame(5, 'tool.finished', {
          toolCallId: MESSAGE_ID,
          toolId: 'tasks.list',
          status: 'done',
          resultPreview: 'Задачи: 1',
          durationMs: 12,
          errorCode: null,
          href: null,
          hrefLabel: null,
        }),
        frame(6, 'message.delta', { text: 'одна задача' }),
        frame(7, 'message.completed', {
          messageId: MESSAGE_ID,
          text: 'У вас одна задача',
          reasoning: 'смотрю задачи',
        }),
        frame(8, 'run.completed', { inputTokens: 10, outputTokens: 20 }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'Какие задачи?',
      userMessageId: null,
    });
    const onDone = vi.fn();
    startRunStream(RUN_ID, SESSION_ID, onDone);

    await waitFor(() => expect(useAssistantStore.getState().live?.status).toBe('done'));
    const live = useAssistantStore.getState().live!;
    expect(live.messageId).toBe(MESSAGE_ID);
    expect(live.model).toBe('model-x');
    expect(live.text).toBe('У вас одна задача');
    expect(live.reasoning).toBe('смотрю задачи');
    expect(live.tools[0]).toMatchObject({ toolId: 'tasks.list', status: 'done' });
    expect(live.inputTokens).toBe(10);
    expect(live.outputTokens).toBe(20);
    expect(onDone).toHaveBeenCalled();
    // Заголовок потока — Bearer и accept SSE.
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).accept).toBe('text/event-stream');
  });

  it('обрыв без терминального события — переподключение с Last-Event-ID', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sse([frame(1, 'message.delta', { text: 'при' })]))
      .mockResolvedValueOnce(
        sse([
          frame(2, 'message.completed', { messageId: MESSAGE_ID, text: 'привет', reasoning: null }),
          frame(3, 'run.completed', { inputTokens: null, outputTokens: null }),
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'вопрос',
      userMessageId: null,
    });
    startRunStream(RUN_ID, SESSION_ID, () => undefined);

    await waitFor(() => expect(useAssistantStore.getState().live?.status).toBe('done'), {
      timeout: 3000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1]! as unknown as [string, RequestInit];
    expect((secondInit.headers as Record<string, string>)['last-event-id']).toBe('1');
    expect(useAssistantStore.getState().live?.text).toBe('привет');
  });

  it('ошибка прогона закрывает буфер с кодом и текстом', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          frame(1, 'run.error', {
            code: 'ASSISTANT_PROVIDER_UNAVAILABLE',
            message: 'Провайдер недоступен',
            retryable: true,
          }),
        ]),
      ),
    );
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'вопрос',
      userMessageId: null,
    });
    startRunStream(RUN_ID, SESSION_ID, () => undefined);
    await waitFor(() => expect(useAssistantStore.getState().live?.status).toBe('error'));
    expect(useAssistantStore.getState().live).toMatchObject({
      errorCode: 'ASSISTANT_PROVIDER_UNAVAILABLE',
      errorMessage: 'Провайдер недоступен',
    });
  });

  it('отмена прогона — статус cancelled, без ошибки', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([frame(1, 'run.cancelled', {})])),
    );
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'вопрос',
      userMessageId: null,
    });
    startRunStream(RUN_ID, SESSION_ID, () => undefined);
    await waitFor(() => expect(useAssistantStore.getState().live?.status).toBe('cancelled'));
  });

  it('HTTP-ошибка открытия потока — понятная ошибка, без ретраев', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'вопрос',
      userMessageId: null,
    });
    startRunStream(RUN_ID, SESSION_ID, () => undefined);
    await waitFor(() => expect(useAssistantStore.getState().live?.status).toBe('error'));
    expect(useAssistantStore.getState().live?.errorCode).toBe('HTTP_502');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('битые кадры пропускаются, неизвестные события не ломают поток', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          'id: 1\nevent: message.delta\ndata: {не json}\n\n',
          frame(2, 'unknown.event', { foo: 1 }),
          frame(3, 'run.completed', { inputTokens: null, outputTokens: null }),
        ]),
      ),
    );
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'вопрос',
      userMessageId: null,
    });
    startRunStream(RUN_ID, SESSION_ID, () => undefined);
    await waitFor(() => expect(useAssistantStore.getState().live?.status).toBe('done'));
    expect(useAssistantStore.getState().live?.text).toBe('');
  });

  it('«Стоп» прерывает поток без статуса ошибки и без нового соединения', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      // Поток никогда не закрывается сам — только отменой.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'вопрос',
      userMessageId: null,
    });
    startRunStream(RUN_ID, SESSION_ID, () => undefined);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    stopRunStream();
    expect(signals[0]!.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAssistantStore.getState().live?.status).toBe('running');
  });
});

describe('восстановление и сброс сессии (#895, AUD-005)', () => {
  it('recoverAssistantRun подхватывает прогон и подписывается с начала журнала', async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        frame(1, 'message.delta', { text: 'до' }),
        frame(2, 'message.completed', { messageId: MESSAGE_ID, text: 'дописано', reasoning: null }),
        frame(3, 'run.completed', { inputTokens: null, outputTokens: null }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    recoverAssistantRun(RUN_ID, SESSION_ID, MESSAGE_ID);
    expect(useAssistantStore.getState().live).toMatchObject({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: '',
      messageId: MESSAGE_ID,
    });
    await waitFor(() => expect(useAssistantStore.getState().live?.status).toBe('done'));
    expect(useAssistantStore.getState().live?.text).toBe('дописано');
  });

  it('сброс сессии закрывает окно и стирает буфер прогона', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    useAssistantStore.setState({ open: true, activeId: SESSION_ID, pending: { text: 'x', at: 1 } });
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'вопрос',
      userMessageId: null,
    });
    startRunStream(RUN_ID, SESSION_ID, () => undefined);
    resetSessionState();
    expect(useAssistantStore.getState()).toMatchObject({
      open: false,
      activeId: null,
      pending: null,
      live: null,
    });
  });

  it('useIsRunActive: живой прогон только в своей сессии', () => {
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: '',
      userMessageId: null,
    });
    const active = renderHook(() => useIsRunActive(SESSION_ID));
    expect(active.result.current).toBe(true);
    const other = renderHook(() => useIsRunActive('другая'));
    expect(other.result.current).toBe(false);
    act(() => useAssistantStore.getState().finishLive('done'));
    expect(active.result.current).toBe(false);
  });
});
