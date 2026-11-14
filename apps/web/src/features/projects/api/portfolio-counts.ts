import { useQuery } from '@tanstack/react-query';
import type { ProjectPortfolioCount } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { projectsKeys } from '../../../shared/api/projects-list.js';

/**
 * Счётчики папок-портфелей журнала (#559): «действует / всего» по видимому
 * срезу. Считает сервер — журнал листается курсором, из страницы чисел не
 * вывести. `scope` — тот же переключатель «Все / Мои», что у журнала: в
 * режиме «Мои» колонка не показывает чужие договоры. Ключ под префиксом
 * `projects.groups`: мутации справочника и перетаскивание проекта
 * перечитывают счётчики вместе со списком.
 */
export function useProjectPortfolioCounts(scope: 'all' | 'mine') {
  return useQuery({
    queryKey: projectsKeys.groupCounts(scope),
    queryFn: () => api<ProjectPortfolioCount[]>(`/projects/groups/counts?scope=${scope}`),
  });
}
