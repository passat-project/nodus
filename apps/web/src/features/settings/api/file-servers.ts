import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileServersResponse } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';

/** Ключ кэша «файловых серверов» (#558): один на портал. */
export const fileServersQueryKey = ['settings', 'file-servers'] as const;

/**
 * Разрешённые файловые серверы (#558): читают все аутентифицированные
 * (список нужен у значения-пути), меняет право `portal.settings.manage`.
 */
export function useFileServersQuery(enabled = true) {
  return useQuery({
    queryKey: fileServersQueryKey,
    queryFn: () => api<FileServersResponse>('/settings/file-servers'),
    enabled,
  });
}

/**
 * Полная замена списка (#558): оптимистично в кэш, откат при ошибке.
 * Повторная запись того же списка — идемпотентна (PUT).
 */
export function useUpdateFileServers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (servers: readonly string[]) =>
      api<FileServersResponse>('/settings/file-servers', {
        method: 'PUT',
        body: { servers },
      }),
    onMutate: async (servers) => {
      await queryClient.cancelQueries({ queryKey: fileServersQueryKey });
      const previous = queryClient.getQueryData<FileServersResponse>(fileServersQueryKey) ?? {
        servers: [],
        updatedAt: new Date(0).toISOString(),
      };
      queryClient.setQueryData<FileServersResponse>(fileServersQueryKey, {
        servers: [...servers],
        updatedAt: new Date().toISOString(),
      });
      return { previous };
    },
    onError: (_error, _servers, context) => {
      if (context?.previous) {
        queryClient.setQueryData(fileServersQueryKey, context.previous);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(fileServersQueryKey, data);
    },
  });
}
