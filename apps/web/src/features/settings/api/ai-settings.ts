import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiSettingsBody,
  AiSettingsResponse,
  AssistantModelCatalogResponse,
  AssistantProviderTestResponse,
} from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';

/** Ключ настроек ИИ-агента: один на портал (читает и пишет администратор). */
export const aiSettingsQueryKey = ['settings', 'ai'] as const;

/** Настройки ИИ-агента: провайдеры без ключей, дефолт, правила (#894). */
export function useAiSettingsQuery(enabled = true) {
  return useQuery({
    queryKey: aiSettingsQueryKey,
    queryFn: () => api<AiSettingsResponse>('/settings/ai'),
    enabled,
  });
}

/**
 * Полная замена настроек одним PUT (идемпотентно, аудит на сервере).
 * Ключ уходит только если администратор ввёл новый.
 */
export function useUpdateAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AiSettingsBody) =>
      api<AiSettingsResponse>('/settings/ai', { method: 'PUT', body }),
    onSuccess: (response) => {
      queryClient.setQueryData(aiSettingsQueryKey, response);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: aiSettingsQueryKey });
    },
  });
}

/** Каталог моделей провайдера — кнопка «Загрузить модели». */
export function useProviderModels() {
  return useMutation({
    mutationFn: (providerId: string) =>
      api<AssistantModelCatalogResponse>(`/settings/ai/providers/${providerId}/models`),
  });
}

/** Проверка соединения: результат приходит данными (ok/ошибка), не 500. */
export function useTestProvider() {
  return useMutation({
    mutationFn: (providerId: string) =>
      api<AssistantProviderTestResponse>(`/settings/ai/providers/${providerId}/test`, {
        method: 'POST',
      }),
  });
}
