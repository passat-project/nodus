import { useMemo } from 'react';
import { NO_PORTFOLIO_FILTER, ui } from '@nodus/contracts';

import { useProjectGroups, useProjectsList } from '../api/projects-list.js';
import type { FilterFieldDef } from './list-filters.js';

/** Вариант фильтра для портфеля-папки: архивная читается названием, а не
 *  uuid-ом в чипе (#559). */
function optionOf(group: { id: string; name: string; archivedAt: string | null }) {
  return {
    value: group.id,
    label:
      group.archivedAt === null
        ? group.name
        : ui.projects.portfolioArchivedOption.replace('{name}', group.name),
  };
}

/**
 * Фильтр «Портфель» списков задач и писем (#559): портфель — папка журнала
 * «Проекты», и его срез нужен там же, где есть фильтр по проекту. Связь
 * «проект → портфель» берётся из справочника проектов (журнал листается
 * сервером, строки списков несут только ссылку на проект). «Без портфеля» —
 * контрактный сентинел `none` (совпадает с журналом проектов).
 */
export function usePortfolioFilterDef<T>({
  projectIdOf,
  visible = true,
}: {
  /** Проект строки списка (задача, письмо): null — строки вне проекта. */
  projectIdOf: (row: T) => string | null | undefined;
  /** Фильтр показывается, только когда уместен фильтр по проекту. */
  visible?: boolean;
}): FilterFieldDef<T> | null {
  // С архивом: задача/письмо архивного портфеля не должны давать uuid в чипе.
  const { data: groups } = useProjectGroups(true);
  const { data: projects } = useProjectsList({ enabled: visible });

  return useMemo(() => {
    const alive = (groups ?? []).filter((group) => group.archivedAt === null);
    const archived = (groups ?? []).filter((group) => group.archivedAt !== null);
    const options = [...alive, ...archived].map(optionOf);
    if (options.length === 0) return null;
    const portfolioOf = new Map(
      (projects?.items ?? []).map((project) => [
        project.id,
        project.portfolio?.id ?? NO_PORTFOLIO_FILTER,
      ]),
    );
    return {
      id: 'portfolio',
      label: ui.projects.filterPortfolio,
      type: 'select' as const,
      options: [...options, { value: NO_PORTFOLIO_FILTER, label: ui.projects.portfolioNone }],
      match: (row: T, value) => {
        const projectId = projectIdOf(row);
        const portfolioId = projectId ? portfolioOf.get(projectId) : undefined;
        return value === NO_PORTFOLIO_FILTER
          ? portfolioId === NO_PORTFOLIO_FILTER
          : portfolioId === value;
      },
    };
  }, [groups, projects, projectIdOf]);
}
