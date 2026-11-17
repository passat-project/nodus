import { useQuery } from '@tanstack/react-query';
import type { AssistantMessageList, AssistantSessionList } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';

/**
 * Запросы данных ассистента (Ф1): сессии и история диалога. Ключи кэша —
 * здесь; мутации и поток прогона живут в `assistant-api.ts`, решения по
 * карточкам и блокнот — в `assistant-actions-api.ts`.
 */

/** Ключи кэша ассистента: фабрика, руками строки не пишутся. */
export const assistantKeys = {
  all: ['assistant'] as const,
  sessions: () => [...assistantKeys.all, 'sessions'] as const,
  messages: (sessionId: string) => [...assistantKeys.all, 'messages', sessionId] as const,
  memory: () => [...assistantKeys.all, 'memory'] as const,
};

/** Сессии сотрудника (последние 50, новые сверху). */
export function useAssistantSessions() {
  return useQuery({
    queryKey: assistantKeys.sessions(),
    queryFn: () => api<AssistantSessionList>('/assistant/sessions'),
  });
}

/** История диалога: сообщения с вызовами инструментов и карточками действий. */
export function useAssistantMessages(sessionId: string | null) {
  return useQuery({
    queryKey: assistantKeys.messages(sessionId ?? 'none'),
    queryFn: () => api<AssistantMessageList>(`/assistant/sessions/${sessionId}/messages`),
    enabled: Boolean(sessionId),
  });
}
