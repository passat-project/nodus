import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssistantAction, AssistantMemoryList } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { useAssistantStore } from '../model/assistant-store.js';
import { assistantKeys } from './assistant-api.js';

/**
 * Карточки действий и блокнот агента (Ф2, ADR-0048; #900): решения по
 * карточке и личная память. Вынесено из `assistant-api.ts`, чтобы поток
 * прогона и лента остались одним файлом, а решения — своим.
 */

/** Общая часть: после решения карточки история диалога перечитывается —
 *  состояние приходит из БД, а не собирается на клиенте. */
function useActionDecision(sessionId: string | null, decision: 'execute' | 'cancel' | 'undo') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AssistantAction>(`/assistant/actions/${id}/${decision}`, { method: 'POST' }),
    onSuccess: (action) => {
      // Живой буфер держит карточку до следующей отправки — обновляем её
      // здесь же, иначе после завершённого прогона карточка оставалась бы
      // «ждёт подтверждения» до перезагрузки страницы.
      useAssistantStore.getState().upsertAction(action);
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
