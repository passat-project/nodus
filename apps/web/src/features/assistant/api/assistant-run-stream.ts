import type { AssistantToolCall } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { useAssistantStore } from '../model/assistant-store.js';
import { parseRunEventData, SseFrameParser } from '../model/assistant-stream.js';
import { assistantToolLabel } from '../components/assistant-tool-label.js';

/**
 * Поток прогона ассистента (#893, #896): SSE через `fetch`, восстановление по
 * `Last-Event-ID`, сборка живого буфера из событий журнала. Вынесено из
 * `assistant-api.ts` по I5: подписка на поток и хуки запросов — разные
 * ответственности; файл `assistant-api.ts` реэкспортирует эти функции, чтобы
 * существующие импорты не менялись.
 *
 * При завершении прогона вызывается `onDone` (инвалидация истории), а буфер
 * стора остаётся до прихода серверных сообщений: лента не мигает.
 */

let activeStream: AbortController | null = null;
/** Хук завершения потока: подписка на отложенное продолжение пачки (#916). */
let streamEndHook: ((sessionId: string, info: { aborted: boolean }) => void) | null = null;

/**
 * Подписка на «поток сессии завершился сам». Регистрирует слой выше
 * (`assistant-api.ts`): при отложенном продолжении пачки подписка на
 * зарезервированный прогон откладывается и включается здесь.
 */
export function setRunStreamEndHook(
  hook: ((sessionId: string, info: { aborted: boolean }) => void) | null,
): void {
  streamEndHook = hook;
}

/** Остановить текущий поток (смена сессии / закрытие окна / новый вопрос). */
export function stopRunStream(): void {
  activeStream?.abort();
  activeStream = null;
}

/**
 * Слушается ли поток прямо сейчас. Живой буфер стора переживает закрытие
 * окна, а поток — нет: по этому признаку окно отличает «прогон уже течёт»
 * от «буфер замёрз, нужен повторный подхват» (#896).
 */
export function isRunStreamActive(): boolean {
  return activeStream !== null && !activeStream.signal.aborted;
}

/**
 * Подписка на поток прогона. Реконнект при обрыве — с `Last-Event-ID`:
 * сервер отдаст пропущенные события, дублей не будет.
 */
export function startRunStream(
  runId: string,
  sessionId: string,
  onDone: (info: { aborted: boolean }) => void,
): void {
  stopRunStream();
  const controller = new AbortController();
  activeStream = controller;
  const store = useAssistantStore.getState();
  let lastEventId = 0;
  let finished = false;

  const run = async (): Promise<void> => {
    while (!controller.signal.aborted && !finished) {
      try {
        const token = useAuthStore.getState().accessToken;
        const response = await fetch(`/api/v1/assistant/runs/${runId}/stream`, {
          headers: {
            accept: 'text/event-stream',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(lastEventId > 0 ? { 'last-event-id': String(lastEventId) } : {}),
          },
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          finished = true;
          store.finishLive('error', {
            code: `HTTP_${response.status}`,
            message: 'Не удалось открыть поток ответа',
          });
          break;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseFrameParser();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
            lastEventId = applyEvent(frame.id, frame.event, frame.data, lastEventId, () => {
              finished = true;
            });
            if (finished) break;
          }
          if (finished) break;
        }
        reader.releaseLock();
        if (finished) break;
        // Поток закрылся без терминального события — восстановление.
        await new Promise((resolve) => setTimeout(resolve, 400));
      } catch {
        if (controller.signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    if (controller.signal === activeStream?.signal) activeStream = null;
    // `aborted` — поток прерван сменой диалога/сбросом, а не завершился сам:
    // подписываться на отложенное продолжение в этом случае нельзя.
    const info = { aborted: controller.signal.aborted };
    onDone(info);
    streamEndHook?.(sessionId, info);
  };

  void run().catch(() => {
    store.finishLive('error', { code: 'internal', message: 'Поток ответа прерван' });
  });
}

/** Событие журнала → живой буфер стора; возвращает последний seq. */
function applyEvent(
  id: string | undefined,
  event: string | undefined,
  data: string,
  currentLast: number,
  onTerminal: () => void,
): number {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return currentLast;
  }
  const seq = Number((payload as { seq?: number }).seq ?? id ?? 0);
  const type = (payload as { type?: string }).type ?? event ?? '';
  const parsed = parseRunEventData(payload);
  if (!parsed.success) return currentLast;
  const live = useAssistantStore.getState();
  switch (parsed.data.type) {
    case 'run.started':
      live.patchLive({ messageId: parsed.data.messageId, model: parsed.data.model });
      break;
    case 'message.delta':
      live.appendDelta('text', parsed.data.text);
      break;
    case 'reasoning.delta':
      live.appendDelta('reasoning', parsed.data.text);
      break;
    case 'tool.started':
      live.upsertTool(toolFromEvent(parsed.data, 'running'));
      break;
    case 'tool.finished':
      live.upsertTool(toolFromEvent(parsed.data, parsed.data.status));
      break;
    case 'action.proposed':
    case 'action.executed':
    case 'action.cancelled':
    case 'action.failed':
    case 'action.undone':
      live.upsertAction(parsed.data.action);
      break;
    case 'message.completed':
      live.patchLive({
        text: parsed.data.text,
        reasoning: parsed.data.reasoning ?? '',
        status: 'done',
      });
      break;
    case 'run.completed':
      live.patchLive({
        status: 'done',
        inputTokens: parsed.data.inputTokens,
        outputTokens: parsed.data.outputTokens,
      });
      onTerminal();
      break;
    case 'run.error':
      live.finishLive('error', { code: parsed.data.code, message: parsed.data.message });
      onTerminal();
      break;
    case 'run.cancelled':
      live.finishLive('cancelled');
      onTerminal();
      break;
  }
  void type;
  // Терминальные события закрывают поток на сервере — локально тоже.
  return Number.isFinite(seq) && seq > currentLast ? seq : currentLast;
}

function toolFromEvent(
  data: { toolCallId: string; toolId: string; status?: string; args?: unknown },
  status: 'running' | 'done' | 'error',
): AssistantToolCall {
  const payload = data as unknown as {
    toolCallId: string;
    toolId: string;
    title?: string;
    args?: Record<string, unknown> | null;
    resultPreview?: string | null;
    durationMs?: number | null;
    errorCode?: string | null;
    href?: string | null;
    hrefLabel?: string | null;
  };
  return {
    id: payload.toolCallId,
    toolId: payload.toolId,
    title: assistantToolLabel(payload.toolId, payload.title),
    status,
    args: payload.args ?? null,
    resultPreview: payload.resultPreview ?? null,
    durationMs: payload.durationMs ?? null,
    errorCode: payload.errorCode ?? null,
    href: payload.href ?? null,
    hrefLabel: payload.hrefLabel ?? null,
  };
}
