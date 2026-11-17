import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssistantAction,
  AssistantActionDecision,
  AssistantBatchDecision,
  AssistantContinueResponse,
  AssistantMemoryList,
} from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { attachAssistantRun, assistantKeys } from './assistant-api.js';
import { useAssistantStore } from '../model/assistant-store.js';

/**
 * Карточки действий и блокнот агента (Ф2, ADR-0048; #900): решения по
 * карточке и личная память. Вынесено из `assistant-api.ts`, чтобы поток
 * прогона и лента остались одним файлом, а решения — своим.
 */

/** Общая часть: после решения карточки история перечитывается — состояние
 *  приходит из БД; если решение закрыло пачку, сервер запустил продолжение
 *  (#916) — подписываемся на его поток сразу. */
function applyDecision(
  sessionId: string | null,
  result: { continuationRunId: string | null },
  actions: AssistantAction[],
): void {
  const store = useAssistantStore.getState();
  for (const action of actions) store.upsertAction(action);
  if (sessionId && result.continuationRunId) {
    attachAssistantRun(result.continuationRunId, sessionId);
  }
}

function useActionDecision(sessionId: string | null, decision: 'execute' | 'cancel' | 'undo') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AssistantActionDecision | AssistantAction>(`/assistant/actions/${id}/${decision}`, {
        method: 'POST',
      }),
    onSuccess: (result) => {
      // Ответ-конверт (#916) для execute/cancel; undo остаётся карточкой.
      const actions = 'action' in result ? [result.action] : [result];
      applyDecision(
        sessionId,
        'continuationRunId' in result ? result : { continuationRunId: null },
        actions,
      );
      if (sessionId) {
        void queryClient.invalidateQueries({ queryKey: assistantKeys.messages(sessionId) });
      }
      void queryClient.invalidateQueries({ queryKey: assistantKeys.sessions() });
    },
  });
}

export function useExecuteAssistantAction(sessionId: string | null) {
  return useActionDecision(sessionId, 'execute');
}

export function useCancelAssistantAction(sessionId: string | null) {
  return useActionDecision(sessionId, 'cancel');
}

export function useUndoAssistantAction(sessionId: string | null) {
  return useActionDecision(sessionId, 'undo');
}

/* ===== Пачка карточек (#916) ===== */

/** «Выполнить все» / «Отменить все»: одна мутация на пачку. */
export function useAssistantBatchDecision(
  sessionId: string | null,
  decision: 'execute-all' | 'cancel-all',
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api<AssistantBatchDecision>(`/assistant/messages/${messageId}/actions/${decision}`, {
        method: 'POST',
      }),
    onSuccess: (result) => {
      applyDecision(sessionId, result, result.actions);
      if (sessionId) {
        void queryClient.invalidateQueries({ queryKey: assistantKeys.messages(sessionId) });
      }
      void queryClient.invalidateQueries({ queryKey: assistantKeys.sessions() });
    },
  });
}

/** «Продолжить сейчас»: пачка закрывается, агент отвечает сразу. */
export function useContinueAssistantBatch(sessionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api<AssistantContinueResponse>(`/assistant/messages/${messageId}/continue`, {
        method: 'POST',
      }),
    onSuccess: (result) => {
      if (sessionId) {
        attachAssistantRun(result.runId, sessionId);
        void queryClient.invalidateQueries({ queryKey: assistantKeys.messages(sessionId) });
      }
      void queryClient.invalidateQueries({ queryKey: assistantKeys.sessions() });
    },
  });
}

/* ===== Блокнот агента (#900) ===== */

export function useAssistantMemory(enabled = true) {
  return useQuery({
    queryKey: assistantKeys.memory(),
    queryFn: () => api<AssistantMemoryList>('/assistant/memory'),
    enabled,
  });
}

export function useDeleteAssistantMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/assistant/memory/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantKeys.memory() });
    },
  });
}
