import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProjectDetail, ProjectGroup, ProjectListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../../../shared/api-client.js';
import { toastApiError } from '../../../shared/api/error-toast.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';
import { JOURNAL_PREFIX, replaceInJournal, type JournalPages } from './project-mutation-helpers.js';

/** Ссылка портфеля по имени из любого закэшированного списка папок (живой
 *  или с архивом): форма журнала показывает имя, а не id. */
function portfolioRefOf(
  queryClient: ReturnType<typeof useQueryClient>,
  portfolioId: string | null,
): ProjectListItem['portfolio'] {
  if (!portfolioId) return null;
  const lists = queryClient.getQueriesData<ProjectGroup[]>({
    queryKey: projectsKeys.groupsPrefix(),
  });
  for (const [, groups] of lists) {
    const hit = groups?.find((group) => group.id === portfolioId);
    if (hit) return { id: hit.id, name: hit.name };
  }
  return null;
}

/**
 * Смена портфеля перетаскиванием проекта на папку журнала (#559). Права —
 * как у правки проекта: руководство проекта или `project.manage` (I8,
 * проверяет сервер; UI не даёт тащить чужие строки). Оптимистично патчит
 * строки журнала и справочник (I4), откат — снапшотом, счётчики папок
 * перечитываются после ответа.
 */
export function useMoveProjectPortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, portfolioId }: { id: string; portfolioId: string | null }) =>
      api<ProjectDetail>(`/projects/${id}`, { method: 'PATCH', body: { portfolioId } }),
    onMutate: async ({ id, portfolioId }) => {
      await queryClient.cancelQueries({ queryKey: JOURNAL_PREFIX });
      // Справочник пикеров патчится тем же ходом — незавершённый рефетч мог
      // бы вернуть старое значение поверх оптимистичного.
      await queryClient.cancelQueries({ queryKey: projectsKeys.options() });
      const journals = queryClient.getQueriesData<JournalPages>({ queryKey: JOURNAL_PREFIX });
      const options = queryClient.getQueriesData<{ items: ProjectListItem[] }>({
        queryKey: projectsKeys.options(),
      });
      const detail = queryClient.getQueryData<ProjectDetail>(projectsKeys.detail(id));
      replaceInJournal(queryClient, id, { portfolio: portfolioRefOf(queryClient, portfolioId) });
      return { journals, options, detail, id };
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.journals ?? []) queryClient.setQueryData(key, data);
      for (const [key, data] of context?.options ?? []) queryClient.setQueryData(key, data);
      if (context?.detail) {
        queryClient.setQueryData(projectsKeys.detail(context.id), context.detail);
      }
      toastApiError(error);
    },
    onSuccess: (project) => {
      // Ответ сервера — истина: строка журнала сразу получает настоящую
      // ссылку портфеля (оптимистично её могло не быть в справочнике).
      replaceInJournal(queryClient, project.id, project);
      toast.success(ui.projects.portfolioMovedDone);
    },
    onSettled: () => {
      // Портфель сменился — журналы, карточка и счётчики папок живут заново.
      void queryClient.invalidateQueries({ queryKey: projectsKeys.all });
    },
  });
}
