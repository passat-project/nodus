import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssistantMcpBody,
  AssistantMcpResponse,
  AssistantMcpTestResponse,
} from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';

/** Ключ реестра MCP-серверов: один на портал (читает и пишет администратор). */
export const mcpSettingsQueryKey = ['settings', 'ai', 'mcp'] as const;

/** MCP-серверы: адреса без ключей, признак «по умолчанию для поиска» (#902). */
export function useMcpSettingsQuery(enabled = true) {
  return useQuery({
    queryKey: mcpSettingsQueryKey,
    queryFn: () => api<AssistantMcpResponse>('/settings/ai/mcp'),
    enabled,
  });
}

/**
 * Полная замена списка одним PUT (идемпотентно, аудит на сервере).
 * Ключ уходит только если администратор ввёл новый.
 */
export function useUpdateMcpSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AssistantMcpBody) =>
      api<AssistantMcpResponse>('/settings/ai/mcp', { method: 'PUT', body }),
    onSuccess: (response) => {
      queryClient.setQueryData(mcpSettingsQueryKey, response);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: mcpSettingsQueryKey });
    },
  });
}

/** Проверка соединения: результат приходит данными (ok/ошибка), не 500. */
export function useTestMcpServer() {
  return useMutation({
    mutationFn: (serverId: string) =>
      api<AssistantMcpTestResponse>(`/settings/ai/mcp/${serverId}/test`, { method: 'POST' }),
  });
}
