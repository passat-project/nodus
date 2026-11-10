import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../api-client.js';
import { projectsKeys } from './projects-list.js';

/**
 * Добавление сотрудников в состав проекта (#674): окно создания задачи
 * секретного проекта после отказа по составу может добавить выбранных людей
 * участниками и повторить создание. Один запрос на человека — существующий
 * маршрут карточки проекта (`POST /projects/:id/members`, kind=member).
 * Оптимистичного кэша здесь нет: окно создания не показывает состав проекта,
 * а после успеха список перечитается инвалидацией.
 */
export function useAddProjectMembers(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userIds: readonly string[]) => {
      for (const userId of userIds) {
        await api<void>(`/projects/${projectId}/members`, {
          method: 'POST',
          body: { userId, kind: 'member' },
        });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
    },
  });
}
