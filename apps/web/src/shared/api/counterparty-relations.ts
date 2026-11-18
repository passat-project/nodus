import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Paginated, ProjectListItem } from '@nodus/contracts';

import { api } from '../api-client.js';

/**
 * Обратные связи карточки контрагента (вкладки «Письма»/«Проекты», #460).
 * Живут в shared/api: потребитель — features/crm, а I6 запрещает фичам
 * импортировать друг друга. Письма контрагента — общий `useLettersInfinite`
 * (`letters-list.ts`, `?counterpartyId=`), проекты заказчика — здесь (`?clientId=`).
 */

export const counterpartyRelationsKeys = {
  projects: (counterpartyId: string, search?: string) =>
    search
      ? ([...['projects', 'client', counterpartyId], { search }] as const)
      : (['projects', 'client', counterpartyId] as const),
};

/** Проекты, где контрагент — заказчик (GET /projects?clientId=). `scope=all` —
 *  все проекты заказчика, видимые смотрящему по правилам видимости, а не
 *  только пересечение с его участием (#866, AUD-028). `enabled: false` —
 *  пока модуля проектов нет (#52), запрос не уходит. `search` (#956) —
 *  серверный поиск по названию/шифру во всей выдаче. */
export function clientProjectsUrl(counterpartyId: string, search = ''): string {
  const query = search.trim();
  return `/projects?clientId=${counterpartyId}&scope=all&limit=100${
    query ? `&search=${encodeURIComponent(query)}` : ''
  }`;
}

export function useClientProjects(
  counterpartyId: string,
  options: { enabled?: boolean; search?: string } = {},
) {
  const query = options.search?.trim() || undefined;
  return useQuery({
    queryKey: counterpartyRelationsKeys.projects(counterpartyId, query),
    queryFn: () => api<Paginated<ProjectListItem>>(clientProjectsUrl(counterpartyId, query)),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}
