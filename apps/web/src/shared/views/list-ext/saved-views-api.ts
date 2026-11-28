import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSavedViewBody, ListEntity, SavedView } from '@nodus/contracts';

import { api } from '../../api-client.js';

/**
 * Сохранённые настройки списков — REST /views (#435). Рамка чтения: журнал
 * (личные), проект (общие + личные + списки типов проекта). Событий нет
 * (I13): после мутаций рамка перечитывается вручную.
 */

export const savedViewsKeys = {
  all: ['views'] as const,
  journal: (entity?: ListEntity) => [...savedViewsKeys.all, 'journal', entity ?? 'any'] as const,
  project: (projectId: string) => [...savedViewsKeys.all, 'project', projectId] as const,
};

/** Личные виды журнала (сущность — по желанию). */
export function useJournalSavedViews(entity?: ListEntity) {
  return useQuery({
    queryKey: savedViewsKeys.journal(entity),
    queryFn: () => api<SavedView[]>(`/views?journal=true${entity ? `&entity=${entity}` : ''}`),
    staleTime: 30_000,
  });
}

/** Виды рамки проекта: общие проектные + личные + списки типов, создаваемых
 *  в проекте (готовые вкладки, порядок сервера: общие → типов → личные). */
export function useProjectSavedViews(projectId: string) {
  return useQuery({
    queryKey: savedViewsKeys.project(projectId),
    queryFn: () => api<SavedView[]>(`/views?projectId=${projectId}`),
    enabled: projectId.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** Создание настройки (уровень и рамка — по телу; права решает сервер). */
export function useCreateSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSavedViewBody) => api<SavedView>('/views', { method: 'POST', body }),
    onSuccess: (view) => {
      void queryClient.invalidateQueries({ queryKey: savedViewsKeys.all });
      if (view.scope.kind === 'journal') {
        queryClient.setQueryData<SavedView[]>(savedViewsKeys.journal(), (old) =>
          old ? [...old, view] : [view],
        );
      }
    },
  });
}

/** Удаление настройки (владелец/руководство/настройщик — сервер). */
export function useDeleteSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/views/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: savedViewsKeys.all });
    },
  });
}
