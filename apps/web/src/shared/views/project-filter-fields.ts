import { useMemo } from 'react';
import type { ProjectListItem } from '@nodus/contracts';
import { NO_PORTFOLIO_FILTER, ui } from '@nodus/contracts';

import { useProjectGroups } from '../api/projects-list.js';
import type { FilterFieldDef, FilterValue } from './list-filters.js';
import type { FilterPreset } from './use-list-toolbar.js';

/** Поисковая строка проекта: шифр (может отсутствовать) + название. */
export const projectSearchText = (p: ProjectListItem) => `${p.code ?? ''} ${p.name}`;

/** Встроенные пресеты проектов (левая колонка панели фильтра). */
export const projectBuiltinPresets: FilterPreset[] = [
  { id: 'managing', name: ui.projects.presetManaging, state: { role: 'manager' } },
  { id: 'open', name: ui.projects.presetOpen, state: { visibility: 'open' } },
  { id: 'secret', name: ui.projects.presetSecret, state: { visibility: 'secret' } },
  { id: 'archived', name: ui.projects.presetArchived, state: { status: 'archived' } },
];

/** Реестр фильтруемых полей журнала проектов (стандарт списков): портфель,
 *  моя роль, видимость, статус — серверные фильтры (Р14 #52). */
export function useProjectFilterDefs(): FilterFieldDef<ProjectListItem>[] {
  // С архивом: выбранная архивная папка обязана читаться названием, а не
  // uuid-ом в чипе фильтра (#559).
  const { data: groups } = useProjectGroups(true);

  return useMemo(() => {
    const alive = (groups ?? []).filter((group) => group.archivedAt === null);
    const archived = (groups ?? []).filter((group) => group.archivedAt !== null);
    return [
      {
        id: 'portfolio',
        label: ui.projects.filterPortfolio,
        type: 'select' as const,
        options: [
          ...alive.map((group) => ({ value: group.id, label: group.name })),
          ...archived.map((group) => ({
            value: group.id,
            label: ui.projects.portfolioArchivedOption.replace('{name}', group.name),
          })),
          // Папка журнала «Без портфеля» (#559): тот же сентинел, что у
          // левой колонки — фильтр и папка показывают один срез.
          { value: NO_PORTFOLIO_FILTER, label: ui.projects.portfolioNone },
        ],
        match: (p: ProjectListItem, v: FilterValue) =>
          v === NO_PORTFOLIO_FILTER ? p.portfolio === null : p.portfolio?.id === v,
      },
      {
        id: 'role',
        label: ui.projects.filterRole,
        type: 'select' as const,
        options: Object.entries(ui.projects.role).map(([value, label]) => ({ value, label })),
        match: (p: ProjectListItem, v: FilterValue) =>
          (p.myMembership.manager && v === 'manager') ||
          (p.myMembership.assistant && v === 'assistant') ||
          (p.myMembership.participant && v === 'participant') ||
          (p.myMembership.observer && v === 'observer'),
      },
      {
        id: 'visibility',
        label: ui.projects.filterVisibility,
        type: 'select' as const,
        options: Object.entries(ui.projects.visibility).map(([value, label]) => ({
          value,
          label,
        })),
        match: (p: ProjectListItem, v: FilterValue) => p.visibility === v,
      },
      {
        id: 'status',
        label: ui.projects.filterStatus,
        type: 'select' as const,
        options: Object.entries(ui.projects.status).map(([value, label]) => ({ value, label })),
        match: (p: ProjectListItem, v: FilterValue) => p.status === v,
      },
    ];
  }, [groups]);
}
