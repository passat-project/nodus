import { useDeferredValue, useMemo, useState } from 'react';
import { Archive, CheckCircle2, Plus, RotateCcw } from 'lucide-react';
import type { ProjectListItem } from '@nodus/contracts';
import { Permission, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { primaryProjectRole } from '../../../shared/lib/project-role.js';
import { openProjectCreate } from '../../../shared/projects/project-create-store.js';
import { SegmentedControl } from '../../../shared/ui/segmented-control.js';
import { DataTable } from '../../../shared/views/data-table.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import { activeFiltersCount } from '../../../shared/views/list-filters.js';
import { makeCardRowMenuItems } from '../../../shared/views/card-row-menu.js';
import { useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import type { RowMenuItem } from '../../../shared/views/row-menu.js';
import {
  projectBuiltinPresets,
  useProjectFilterDefs,
} from '../../../shared/views/project-filter-fields.js';
import { useProjectTableFields } from '../../../shared/views/project-table-fields.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { useProjectStatus } from '../api/project-mutations.js';
import { useProjectsJournal } from '../api/projects-api.js';
import { ProjectArchiveDialog } from '../components/project-archive-dialog.js';
import type { ProjectJournalFilters, ProjectRoleFilter } from '../lib/project-journal.js';

const SCOPE_KEY = 'nodus-projects-scope-v1';

/** «Все / Мои» журнала: «Все» — весь видимый срез (открытые + секретные
 *  моего участия), «Мои» — только моё участие; выбор помнится. */
function useJournalScope(): ['all' | 'mine', (scope: 'all' | 'mine') => void] {
  const [scope, setScope] = useState<'all' | 'mine'>(() =>
    localStorage.getItem(SCOPE_KEY) === 'mine' ? 'mine' : 'all',
  );
  return [
    scope,
    (next) => {
      localStorage.setItem(SCOPE_KEY, next);
      setScope(next);
    },
  ];
}

/**
 * Проекты: журнал канонической таблицей (shared/views, ключ `projects.list`).
 * Шапка — одна строка: заголовок, счётчик, «Создать» слева от поиска,
 * переключатель «Все/Мои», шестерёнка колонок. Фильтры — СЕРВЕРНЫЕ
 * (портфель/моя роль/видимость/статус, Р14 #52) с курсорной пагинацией;
 * чипы активных фильтров и пресеты — общая строка инструментов. Открытие —
 * карточка проекта в стеке (shared-element из rect строки).
 */
export function ProjectsPage() {
  const [scope, setScope] = useJournalScope();
  const toolbar = useListToolbar('projects.journal', projectBuiltinPresets);
  // Реестр колонок — хук: атрибуты портала (#632) приходят с сервера.
  const fields = useProjectTableFields();
  const filterDefs = useProjectFilterDefs();
  const search = useDeferredValue(toolbar.query);
  const filters = useMemo<ProjectJournalFilters>(() => {
    const state = toolbar.filters;
    return {
      scope,
      search,
      role: typeof state.role === 'string' ? (state.role as ProjectRoleFilter) : undefined,
      visibility:
        state.visibility === 'open' || state.visibility === 'secret' ? state.visibility : undefined,
      status:
        state.status === 'active' || state.status === 'completed' || state.status === 'archived'
          ? state.status
          : undefined,
      portfolioId: typeof state.portfolio === 'string' ? state.portfolio : undefined,
    };
  }, [scope, search, toolbar.filters]);
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useProjectsJournal(filters);
  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const openCard = useOpenCard();
  const status = useProjectStatus();
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canManageAny = (permissions ?? []).includes(Permission.PROJECT_MANAGE);
  const [archiveTarget, setArchiveTarget] = useState<ProjectListItem | null>(null);

  const filtering =
    toolbar.query.trim() !== '' || activeFiltersCount(filterDefs, toolbar.filters) > 0;

  function rowMenu(project: ProjectListItem): RowMenuItem[] {
    const base = makeCardRowMenuItems({ kind: 'project', id: project.id }, openCard);
    const role = primaryProjectRole(project.myMembership);
    const management = role === 'manager' || role === 'assistant' || canManageAny;
    if (!management) return base;
    const actions: RowMenuItem[] = [];
    if (project.status === 'active') {
      actions.push({
        id: 'complete',
        icon: <CheckCircle2 className="size-3.5" />,
        label: ui.projects.statusComplete,
        separatorBefore: true,
        onSelect: () => status.mutate({ id: project.id, status: 'completed' }),
      });
    }
    if (project.status !== 'archived') {
      actions.push({
        id: 'archive',
        icon: <Archive className="size-3.5" />,
        label: ui.projects.statusArchive,
        onSelect: () => setArchiveTarget(project),
      });
    } else {
      actions.push({
        id: 'reactivate',
        icon: <RotateCcw className="size-3.5" />,
        label: ui.projects.statusReactivate,
        separatorBefore: true,
        onSelect: () => status.mutate({ id: project.id, status: 'active' }),
      });
    }
    return [...base, ...actions];
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 px-6">
        <h1 className="shrink-0 text-xl font-semibold text-balance text-foreground">
          {ui.projects.title}
          <span className="ml-2 align-middle font-mono text-label-lg font-normal text-muted-foreground tabular-nums">
            {items.length}
          </span>
        </h1>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={filterDefs}
          builtinPresets={projectBuiltinPresets}
          left={
            <Button type="button" onClick={() => openProjectCreate()}>
              <Plus data-icon="inline-start" />
              {ui.common.create}
            </Button>
          }
          right={
            <>
              <SegmentedControl
                size="sm"
                ariaLabel={ui.projects.title}
                value={scope}
                options={[
                  { value: 'all', label: ui.projects.scopeAll },
                  { value: 'mine', label: ui.projects.scopeMine },
                ]}
                onChange={setScope}
                activeClassName="bg-accent text-foreground"
                className="w-32 shrink-0"
              />
              <ViewSettings viewKey="projects.list" defs={fields} />
            </>
          }
        />
      </div>
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey="projects.list"
          defs={fields}
          rows={items}
          rowKey={(project) => project.id}
          isLoading={isLoading}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          onOpenRow={(project, rowEl) =>
            openCard({ kind: 'project', id: project.id }, rowEl.getBoundingClientRect())
          }
          rowMenu={rowMenu}
          label={ui.projects.title}
          emptyTitle={filtering ? ui.projects.journalEmptyFiltered : ui.projects.journalEmpty}
        />
      </div>
      <ProjectArchiveDialog
        name={archiveTarget?.name ?? null}
        open={archiveTarget !== null}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          if (archiveTarget) {
            status.mutate({ id: archiveTarget.id, status: 'archived' });
          }
          setArchiveTarget(null);
        }}
      />
    </div>
  );
}
