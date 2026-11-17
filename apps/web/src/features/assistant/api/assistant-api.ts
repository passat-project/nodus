import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  AssistantMessageList,
  AssistantSession,
  AssistantSessionList,
  SendAssistantMessageResponse,
} from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { assistantKeys, useAssistantMessages, useAssistantSessions } from './assistant-queries.js';
import { queryClient } from '../../../shared/lib/query-client.js';
import { registerSessionReset } from '../../../shared/session-reset.js';
import { useAssistantStore } from '../model/assistant-store.js';
import { mergeLiveMessage } from '../model/assistant-merge.js';
import type { StreamEvent } from '../model/assistant-stream.js';
import {
  isRunStreamActive,
  setRunStreamEndHook,
  startRunStream,
  stopRunStream,
} from './assistant-run-stream.js';

/**
 * Сброс сессии (AUD-005): выход или вход другим сотрудником в той же вкладке
 * обязан стереть диалог предыдущего из памяти вкладки. В буфере прогона —
 * его вопрос и ответ ассистента, в `activeId` — чужая сессия: без сброса
 * следующий вошедший увидел бы чужой диалог, а живой поток продолжал бы
 * дописывать дельты от имени предыдущего (находка security-ревью 17.11.2026).
 */
registerSessionReset(() => {
  stopRunStream();
  clearPendingAttach();
  useAssistantStore.setState({
    open: false,
    activeId: null,
    pending: null,
    live: null,
    bypass: false,
  });
});

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

/** Удаление диалога «крестиком» в списке сессий (18.11): 204, каскад на сервере. */
export function useDeleteAssistantSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/assistant/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: assistantKeys.messages(id) });
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
      /** Байпас подтверждений (ADR-0048): действия выполняются сразу. */
      bypass?: boolean;
    }) =>
      api<SendAssistantMessageResponse>(`/assistant/sessions/${input.sessionId}/messages`, {
        method: 'POST',
        body: {
          text: input.text,
          ...(input.context ? { context: input.context } : {}),
          ...(input.bypass ? { bypass: true } : {}),
        },
      }),
    // Канон оптимистичности (I4) с поправкой на НАБЛЮДАЕМОЕ мигание (18.11):
    // временная строка с клиентским id жила 50–150 мс, потом дважды меняла id
    // (pending → live → серверный) и React ПЕРЕМОНТИРОВАЛ пузырь — окно
    // мерцало. Теперь вопрос встаёт в ленту из живого буфера с СЕРВЕРНЫМ id
    // сразу (POST отвечает за десятки миллисекунд), а id больше не меняется
    // ни при рефетче, ни при завершении прогона. Кэш не трогаем: при ошибке
    // POST текст возвращает композер (канон #124/#248), фантомных строк нет.
    onMutate: async (input) => {
      const key = assistantKeys.messages(input.sessionId);
      // In-flight запрос истории мог бы вернуться ПОСЛЕ старта прогона и
      // затереть свежие строки — отменяем до старта (канон optimistic update).
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<AssistantMessageList>(key);
      return { key, previous };
    },
    onError: (_error, _input, context) => {
      if (!context || !context.previous) return;
      queryClient.setQueryData(context.key, context.previous);
    },
    onSuccess: (response, input) => {
      useAssistantStore.getState().startLive({
        runId: response.runId,
        sessionId: input.sessionId,
        userText: input.text,
        userMessageId: response.messageId,
      });
      // Вопрос и строка прогона уже в БД (POST их создал) — история
      // подтягивается сразу, а не после ответа модели: живой пузырь вопроса и
      // серверная строка совпадают по id и не перемонтируются.
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
    onSuccess: () => {
      // Сервер вместе с текущим прогоном отменяет зарезервированное
      // продолжение — подписываться на него уже незачем.
      clearPendingAttach();
    },
  });
}

/**
 * Прогон, ожидающий подписки: решение по последней карточке пришло, пока
 * исходный ответ ещё печатался. Сервер зарезервировал прогон и вернул его id,
 * но подписка СРАЗУ оборвала бы живой поток вопроса (startRunStream начинается
 * с stopRunStream) — текст ответа исчез бы из ленты. Поэтому подключаемся
 * после завершения текущего потока.
 */
let pendingAttach: { runId: string; sessionId: string } | null = null;

/** Отменить ожидающую подписку (сброс сессии, «Стоп»). */
export function clearPendingAttach(): void {
  pendingAttach = null;
}

function attachNow(runId: string, sessionId: string): void {
  const store = useAssistantStore.getState();
  store.startLive({ runId, sessionId, userText: '', userMessageId: null });
  startRunStream(runId, sessionId, () => {
    void queryClient.invalidateQueries({ queryKey: assistantKeys.messages(sessionId) });
    void queryClient.invalidateQueries({ queryKey: assistantKeys.sessions() });
  });
}

// Завершение ЛЮБОГО потока сессии (вопрос, восстановление, продолжение):
// подхватываем отложенную подписку, только если поток завершился сам.
setRunStreamEndHook((sessionId, { aborted }) => {
  if (!aborted) flushPendingAttach(sessionId);
});

/** Подхват отложенной подписки после завершения текущего потока сессии. */
function flushPendingAttach(sessionId: string): void {
  const pending = pendingAttach;
  if (!pending || pending.sessionId !== sessionId) return;
  pendingAttach = null;
  // Пока печатался исходный ответ, сотрудник мог уйти в другой диалог:
  // подписка на невидимую сессию переключила бы окно без его действия.
  if (useAssistantStore.getState().activeId !== sessionId) return;
  attachNow(pending.runId, pending.sessionId);
}

/**
 * Подписка на прогон, запущенный СЕРВЕРОМ без вопроса сотрудника (#916):
 * продолжение после решений по карточкам. Живой буфер создаётся без текста
 * вопроса — история уже содержит предыдущий ход, а новый ответ печатается
 * в потоке и сохраняется в БД.
 */
export function attachAssistantRun(runId: string, sessionId: string): void {
  const { live } = useAssistantStore.getState();
  // Исходный прогон ещё печатает: подписка сейчас оборвала бы его поток и
  // затёрла буфер (блокер валидации 18.11.2026). Запоминаем и подключаемся
  // на завершении текущего потока.
  if (isRunStreamActive() && live?.sessionId === sessionId && live.runId !== runId) {
    pendingAttach = { runId, sessionId };
    return;
  }
  attachNow(runId, sessionId);
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

export { mergeLiveMessage };
export { assistantKeys, useAssistantMessages, useAssistantSessions };
// Поток прогона живёт в `assistant-run-stream.ts` (I5); реэкспорт сохраняет
// существующие импорты компонентов и тестов.
export { isRunStreamActive, startRunStream, stopRunStream };

/** Идёт ли прогон в этой сессии (кнопка «Стоп», точки набора). */
export function useIsRunActive(sessionId: string | null): boolean {
  const live = useAssistantStore((state) => state.live);
  return Boolean(live && live.status === 'running' && live.sessionId === sessionId);
}

export type { StreamEvent };
