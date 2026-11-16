import { useMemo } from 'react';
import { NO_PORTFOLIO_FILTER, ui } from '@nodus/contracts';

import { useProjectGroups, useProjectsList } from '../api/projects-list.js';
import type { FilterFieldDef } from './list-filters.js';

/**
 * Фильтр «Портфель» списков задач и писем (#559): портфель — папка журнала
 * «Проекты», и его срез нужен там же, где есть фильтр по проекту. Связь
 * «проект → портфель» берётся из справочника проектов (журнал листается
 * сервером, строки списков несут только ссылку на проект). «Без портфеля» —
 * контрактный сентинел `none` (совпадает с журналом проектов).
 *
 * Архива у папки нет (13.11.2026), поэтому варианты фильтра — сам справочник
 * папок без статусов.
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
  const { data: groups } = useProjectGroups();
  const { data: projects } = useProjectsList({ enabled: visible });

  return useMemo(() => {
    const options = (groups ?? []).map((group) => ({ value: group.id, label: group.name }));
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
