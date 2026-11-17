// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { waitFor } from '@testing-library/react';

import {
  attachAssistantRun,
  clearPendingAttach,
  startRunStream,
  stopRunStream,
} from './assistant-api.js';
import { useAssistantStore } from '../model/assistant-store.js';

/**
 * Отложенное продолжение пачки (#916): решение по последней карточке пришло,
 * пока ответ ещё печатается. Подписка на зарезервированный прогон НЕ должна
 * обрывать живой поток и стирать текст; она откладывается до завершения и
 * подхватывается, только если поток завершился сам (не был оборван сменой
 * диалога/«Стоп»). Блокер валидации 18.11.2026.
 */

const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const CONTINUATION_RUN_ID = '55555555-5555-4555-8555-555555555555';

function frame(seq: number, type: string, data: Record<string, unknown>): string {
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ seq, type, ...data })}\n\n`;
}

function sse(frames: string[]): Response {
  const body = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

beforeEach(() => {
  useAssistantStore.setState({ open: false, activeId: null, pending: null, live: null });
});

afterEach(() => {
  stopRunStream();
  clearPendingAttach();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('attachAssistantRun: отложенное продолжение пачки (#916)', () => {
  it('не рвёт поток печатающегося ответа и подключается после его завершения', async () => {
    useAssistantStore.setState({ activeId: SESSION_ID });
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'вопрос',
      userMessageId: null,
    });
    let finishFirst!: () => void;
    const firstBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(frame(1, 'message.delta', { text: 'Печатаю' })),
        );
        finishFirst = () => {
          controller.enqueue(
            new TextEncoder().encode(
              frame(2, 'run.completed', { inputTokens: 1, outputTokens: 2 }),
            ),
          );
          controller.close();
        };
      },
    });
    const second = sse([
      frame(1, 'message.delta', { text: 'Продолжаю' }),
      frame(2, 'run.completed', { inputTokens: 1, outputTokens: 2 }),
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes(CONTINUATION_RUN_ID)
          ? second
          : new Response(firstBody, {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            }),
      ),
    );

    const onDone = vi.fn();
    startRunStream(RUN_ID, SESSION_ID, onDone);
    await waitFor(() => expect(useAssistantStore.getState().live?.text).toBe('Печатаю'));

    attachAssistantRun(CONTINUATION_RUN_ID, SESSION_ID);
    expect(useAssistantStore.getState().live?.runId).toBe(RUN_ID);
    expect(useAssistantStore.getState().live?.text).toBe('Печатаю');
    expect(onDone).not.toHaveBeenCalled();

    finishFirst();
    await waitFor(() => expect(useAssistantStore.getState().live?.runId).toBe(CONTINUATION_RUN_ID));
    expect(onDone).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useAssistantStore.getState().live?.text).toBe('Продолжаю'));
  });

  it('оборванный поток (смена диалога) не подхватывает отложенное продолжение', async () => {
    useAssistantStore.setState({ activeId: SESSION_ID });
    useAssistantStore.getState().startLive({
      runId: RUN_ID,
      sessionId: SESSION_ID,
      userText: 'вопрос',
      userMessageId: null,
    });
    // Поток без терминального события зацикливается на переподключение с
    // паузой — «Стоп» попадает в паузу и завершает цикл как оборванный.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([frame(1, 'message.delta', { text: 'Печ' })])),
    );
    startRunStream(RUN_ID, SESSION_ID, () => undefined);
    await waitFor(() => expect(useAssistantStore.getState().live?.text).toBe('Печ'));
    attachAssistantRun(CONTINUATION_RUN_ID, SESSION_ID);
    stopRunStream();
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Подписки на продолжение нет: буфер не переключился на второй прогон.
    expect(useAssistantStore.getState().live?.runId).toBe(RUN_ID);
  });

  it('без активного потока подписывается сразу', () => {
    useAssistantStore.setState({ activeId: SESSION_ID });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse([])),
    );
    attachAssistantRun(CONTINUATION_RUN_ID, SESSION_ID);
    expect(useAssistantStore.getState().live?.runId).toBe(CONTINUATION_RUN_ID);
  });
});
