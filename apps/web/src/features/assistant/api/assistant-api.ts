import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssistantMessage,
  AssistantMessageList,
  AssistantSession,
  AssistantSessionList,
  AssistantToolCall,
  SendAssistantMessageResponse,
} from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { queryClient } from '../../../shared/lib/query-client.js';
import { registerSessionReset } from '../../../shared/session-reset.js';
import { useAssistantStore } from '../model/assistant-store.js';
import { mergeLiveMessage } from '../model/assistant-merge.js';
import { parseRunEventData, SseFrameParser, type StreamEvent } from '../model/assistant-stream.js';

/** Ключи кэша ассистента: фабрика, руками строки не пишутся. */
export const assistantKeys = {
  all: ['assistant'] as const,
  sessions: () => [...assistantKeys.all, 'sessions'] as const,
  messages: (sessionId: string) => [...assistantKeys.all, 'messages', sessionId] as const,
};

/** Сессии сотрудника (последние 50, новые сверху). */
export function useAssistantSessions() {
  return useQuery({
    queryKey: assistantKeys.sessions(),
    queryFn: () => api<AssistantSessionList>('/assistant/sessions'),
  });
}

/**
 * Сброс сессии (AUD-005): выход или вход другим сотрудником в той же вкладке
 * обязан стереть диалог предыдущего из памяти вкладки. В буфере прогона —
 * его вопрос и ответ ассистента, в `activeId` — чужая сессия: без сброса
 * следующий вошедший увидел бы чужой диалог, а живой поток продолжал бы
 * дописывать дельты от имени предыдущего (находка security-ревью 17.11.2026).
 */
registerSessionReset(() => {
  stopRunStream();
  useAssistantStore.setState({ open: false, activeId: null, pending: null, live: null });
});

/** История диалога: сообщения с вызовами инструментов. */
export function useAssistantMessages(sessionId: string | null) {
  return useQuery({
    queryKey: assistantKeys.messages(sessionId ?? 'none'),
    queryFn: () => api<AssistantMessageList>(`/assistant/sessions/${sessionId}/messages`),
    enabled: Boolean(sessionId),
  });
}

export function useCreateAssistantSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<AssistantSession>('/assistant/sessions', { method: 'POST', body: {} }),
    onSuccess: (session) => {
      queryClient.setQueryData<AssistantSessionList>(assistantKeys.sessions(), (current) => ({
        items: [session, ...(current?.items ?? [])],
        nextCursor: null,
      }));
    },
  });
}

export function useRenameAssistantSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; title?: string; archived?: boolean }) =>
      api<AssistantSession>(`/assistant/sessions/${input.id}`, {
        method: 'PATCH',
        body: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.archived !== undefined ? { archived: input.archived } : {}),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.sessions() });
    },
  });
}

/**
 * Отправка сообщения (I4: пузырь сотрудника появляется сразу): `POST`
 * отвечает `202 { runId, messageId }`, дальше поток прогона наполняет буфер
 * стора.
 */
export function useSendAssistantMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      sessionId: string;
      text: string;
      context?: { moduleId?: string | null; cardKind?: string | null; cardId?: string | null };
    }) =>
      api<SendAssistantMessageResponse>(`/assistant/sessions/${input.sessionId}/messages`, {
        method: 'POST',
        body: { text: input.text, ...(input.context ? { context: input.context } : {}) },
      }),
    // КАНОН МЕССЕНДЖЕРА (#48, I4): вопрос встаёт в ленту ДО запроса —
    // временная строка живёт в кэше истории и откатывается ошибкой. Без
    // этого ответ модели начинал печататься раньше самого вопроса.
    onMutate: async (input) => {
      const key = assistantKeys.messages(input.sessionId);
      // In-flight запрос истории (idle-загрузка сразу после выбора сессии)
      // мог бы вернуться ПОСЛЕ вставки и затереть оптимистичный пузырь —
      // отменяем его до снимка (канон optimistic update, patterns.md).
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<AssistantMessageList>(key);
      const optimistic: AssistantMessage = {
        id: `pending-${crypto.randomUUID()}`,
        role: 'user',
        text: input.text,
        reasoning: null,
        createdAt: new Date().toISOString(),
        runId: null,
        streaming: false,
        errorCode: null,
        toolCalls: [],
      };
      queryClient.setQueryData<AssistantMessageList>(key, (current) => ({
        items: [...(current?.items ?? []), optimistic],
        nextCursor: current?.nextCursor ?? null,
      }));
      return { key, previous, optimisticId: optimistic.id };
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      // Откат: снимок истории до вставки; его не было (новая сессия) —
      // временная строка удаляется вместе с пустым кэшем.
      if (context.previous) queryClient.setQueryData(context.key, context.previous);
      else queryClient.removeQueries({ queryKey: context.key });
    },
    onSuccess: (response, input) => {
      useAssistantStore.getState().startLive({
        runId: response.runId,
        sessionId: input.sessionId,
        userText: input.text,
        userMessageId: response.messageId,
      });
      // Вопрос и строка прогона уже в БД (POST их создал) — история
      // подтягивается сразу, а не после ответа модели: временная строка
      // сменяется серверной без мигания.
      void queryClient.invalidateQueries({ queryKey: assistantKeys.messages(input.sessionId) });
      startRunStream(response.runId, input.sessionId, () => {
        void queryClient.invalidateQueries({ queryKey: assistantKeys.messages(input.sessionId) });
        void queryClient.invalidateQueries({ queryKey: assistantKeys.sessions() });
      });
    },
  });
}

/** Остановить текущий прогон: «Стоп» в шапке окна. */
export function useCancelAssistantRun() {
  return useMutation({
    mutationFn: (runId: string) => api(`/assistant/runs/${runId}/cancel`, { method: 'POST' }),
  });
}

/**
 * Подхват незавершённого прогона (скоуп #895): окно закрыли/перезагрузили
 * во время ответа — сервер прогон доведёт, но клиент об этом не знает.
 * Найденное `streaming`-сообщение с `runId` подключаем к потоку с начала
 * журнала (`Last-Event-ID: 0`): дельты пересобирают текст, `tool.*` —
 * строки вызовов; на завершении история перечитывается и живой буфер
 * уступает сохранённой строке по `messageId`.
 */
export function recoverAssistantRun(
  runId: string,
  sessionId: string,
  messageId: string | null,
): void {
  const store = useAssistantStore.getState();
  store.startLive({ runId, sessionId, userText: '', userMessageId: null });
  store.patchLive({ messageId });
  startRunStream(runId, sessionId, () => {
    void queryClient.invalidateQueries({ queryKey: assistantKeys.messages(sessionId) });
    void queryClient.invalidateQueries({ queryKey: assistantKeys.sessions() });
  });
}

/* ===== Поток прогона (SSE через fetch) ===== */

let activeStream: AbortController | null = null;

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
 *
 * При завершении прогона вызывается `onDone` (инвалидация истории), а буфер
 * стора остаётся до прихода серверных сообщений: лента не мигает.
 */
export function startRunStream(runId: string, sessionId: string, onDone: () => void): void {
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
            lastEventId = applyEvent(frame.id, frame.event, frame.data, sessionId, lastEventId);
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
    onDone();
  };

  void run().catch(() => {
    store.finishLive('error', { code: 'internal', message: 'Поток ответа прерван' });
  });

  function applyEvent(
    id: string | undefined,
    event: string | undefined,
    data: string,
    currentSessionId: string,
    currentLast: number,
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
        finished = true;
        break;
      case 'run.error':
        live.finishLive('error', { code: parsed.data.code, message: parsed.data.message });
        finished = true;
        break;
      case 'run.cancelled':
        live.finishLive('cancelled');
        finished = true;
        break;
    }
    void type;
    void currentSessionId;
    // Терминальные события закрывают поток на сервере — локально тоже.
    return Number.isFinite(seq) && seq > currentLast ? seq : currentLast;
  }
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
    title: payload.title ?? payload.toolId,
    status,
    args: payload.args ?? null,
    resultPreview: payload.resultPreview ?? null,
    durationMs: payload.durationMs ?? null,
    errorCode: payload.errorCode ?? null,
    href: payload.href ?? null,
    hrefLabel: payload.hrefLabel ?? null,
  };
}

export { mergeLiveMessage };

/** Идёт ли прогон в этой сессии (кнопка «Стоп», точки набора). */
export function useIsRunActive(sessionId: string | null): boolean {
  const live = useAssistantStore((state) => state.live);
  return Boolean(live && live.status === 'running' && live.sessionId === sessionId);
}

export type { StreamEvent };
