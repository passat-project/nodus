import { useDeferredValue, useMemo, useState } from 'react';
import { Archive, CheckCircle2, Plus, RotateCcw } from 'lucide-react';
import type { ProjectListItem } from '@nodus/contracts';
import { Permission, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { openProjectCreate } from '../../../shared/projects/project-create-store.js';
import { SEGMENTED_ACTIVE_TONAL, SegmentedControl } from '../../../shared/ui/segmented-control.js';
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
import { useProjectPortfolioCounts } from '../api/portfolio-counts.js';
import {
  useArchiveProjectGroup,
  useCreateProjectGroup,
  useRenameProjectGroup,
  useRestoreProjectGroup,
} from '../api/project-catalog-mutations.js';
import { useProjectStatus } from '../api/project-mutations.js';
import { useMoveProjectPortfolio } from '../api/project-portfolio-mutation.js';
import { useProjectGroups, useProjectsJournal } from '../api/projects-api.js';
import { ProjectArchiveDialog } from '../components/project-archive-dialog.js';
import { PortfolioArchiveDialog, PortfolioRenameDialog } from '../components/portfolio-dialogs.js';
import { PortfolioRail } from '../components/portfolio-rail.js';
import type { ProjectJournalFilters, ProjectRoleFilter } from '../lib/project-journal.js';
import { canDragProject, canEditProject } from '../lib/project-edit-rights.js';
import {
  buildPortfolioFolders,
  portfolioFilterOf,
  type PortfolioFolder,
} from '../lib/portfolio-folders.js';

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

/** Выбранная папка из фильтра журнала: `all` — «Все проекты» (#559). */
function folderOfFilter(value: unknown): string {
  return typeof value === 'string' && value !== '' ? value : 'all';
}

/** Статус внутри папки: пустой фильтр — «все статусы». */
function statusOfFilter(value: unknown): NonNullable<ProjectJournalFilters['status']> | 'all' {
  return value === 'active' || value === 'completed' || value === 'archived' ? value : 'all';
}

/**
 * Проекты: журнал канонической таблицей (shared/views, ключ `projects.list`)
 * и ЛЕВАЯ КОЛОНКА ПАПОК-ПОРТФЕЛЕЙ (#559): «Все проекты», портфели со
 * счётчиками, «Без портфеля», архивные папки; перетаскивание проекта на
 * папку меняет портфель (права правки проекта — сервер). Шапка — одна строка:
 * заголовок, счётчик, «Создать» слева от поиска, переключатель «Все/Мои»,
 * шестерёнка колонок. Фильтры — СЕРВЕРНЫЕ (портфель/роль/видимость/статус,
 * Р14 #52) с курсорной пагинацией; чипы активных фильтров и пресеты — общая
 * строка инструментов. Открытие — карточка проекта в стеке.
 */
export function ProjectsPage() {
  const [scope, setScope] = useJournalScope();
  const toolbar = useListToolbar('projects.journal', projectBuiltinPresets);
  // Реестр колонок — хук: атрибуты портала (#632) приходят с сервера.
  const fields = useProjectTableFields();
  const filterDefs = useProjectFilterDefs();
  const search = useDeferredValue(toolbar.query);
  const selection = folderOfFilter(toolbar.filters.portfolio);
  const status = statusOfFilter(toolbar.filters.status);
  const filters = useMemo<ProjectJournalFilters>(() => {
    const state = toolbar.filters;
    return {
      scope,
      search,
      role: typeof state.role === 'string' ? (state.role as ProjectRoleFilter) : undefined,
      visibility:
        state.visibility === 'open' || state.visibility === 'secret' ? state.visibility : undefined,
      status: status === 'all' ? undefined : status,
      portfolioId:
        typeof state.portfolio === 'string' && state.portfolio !== '' ? state.portfolio : undefined,
    };
  }, [scope, search, toolbar.filters, status]);
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useProjectsJournal(filters);
  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const openCard = useOpenCard();
  const statusMutation = useProjectStatus();
  const moveToPortfolio = useMoveProjectPortfolio();
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canManageAny = (permissions ?? []).includes(Permission.PROJECT_MANAGE);
  const canCreate = (permissions ?? []).includes(Permission.PROJECT_CREATE);

  const groupsQuery = useProjectGroups(true);
  const countsQuery = useProjectPortfolioCounts(scope);
  const folders = useMemo(
    () => buildPortfolioFolders(groupsQuery.data ?? [], countsQuery.data ?? []),
    [groupsQuery.data, countsQuery.data],
  );
  const createFolder = useCreateProjectGroup();
  const renameFolder = useRenameProjectGroup();
  const archiveFolder = useArchiveProjectGroup();
  const restoreFolder = useRestoreProjectGroup();

  const [archiveTarget, setArchiveTarget] = useState<ProjectListItem | null>(null);
  const [renameFolderTarget, setRenameFolderTarget] = useState<PortfolioFolder | null>(null);
  const [archiveFolderTarget, setArchiveFolderTarget] = useState<PortfolioFolder | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const filtering =
    toolbar.query.trim() !== '' || activeFiltersCount(filterDefs, toolbar.filters) > 0;

  /** Клик по папке: серверный фильтр журнала; статус внутри папки — заново. */
  function selectFolder(folderId: string) {
    const next = { ...toolbar.filters };
    const portfolio = portfolioFilterOf(folderId);
    if (portfolio) next.portfolio = portfolio;
    else delete next.portfolio;
    delete next.status;
    toolbar.setFilters(next);
  }

  /** Смена портфеля перетаскиванием: права правки проекта (руководство или
   *  project.manage) — сервер; строка, которая уже в папке, не дёргает сеть. */
  function dropOnFolder(folderId: string) {
    const project = items.find((row) => row.id === draggingId);
    setDraggingId(null);
    if (!project) return;
    const nextPortfolioId = folderId === 'none' ? null : folderId;
    if ((project.portfolio?.id ?? null) === nextPortfolioId) return;
    moveToPortfolio.mutate({ id: project.id, portfolioId: nextPortfolioId });
  }

  /** Тащить строку может тот, кто правит проект (та же проверка, что у меню);
   *  архивный проект — только `project.manage` (сервер: поля заморожены). */
  function rowMenu(project: ProjectListItem): RowMenuItem[] {
    const base = makeCardRowMenuItems({ kind: 'project', id: project.id }, openCard);
    if (!canEditProject(project, canManageAny)) return base;
    const actions: RowMenuItem[] = [];
    if (project.status === 'active') {
      actions.push({
        id: 'complete',
        icon: <CheckCircle2 className="size-3.5" />,
        label: ui.projects.statusComplete,
        separatorBefore: true,
        onSelect: () => statusMutation.mutate({ id: project.id, status: 'completed' }),
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
        onSelect: () => statusMutation.mutate({ id: project.id, status: 'active' }),
      });
    }
    return [...base, ...actions];
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-64 shrink-0 flex-col overflow-y-auto p-3 pr-0">
        <PortfolioRail
          tree={folders}
          selection={selection}
          status={status}
          canCreate={canCreate}
          canManage={canManageAny}
          allLabel={scope === 'mine' ? ui.projects.portfolioMyProjects : undefined}
          draggingProjectId={draggingId}
          onCreate={(name) => createFolder.mutate(name)}
          onSelect={selectFolder}
          onStatus={(next) => toolbar.setFilter('status', next === 'all' ? undefined : next)}
          onRename={setRenameFolderTarget}
          onArchive={setArchiveFolderTarget}
          onRestore={(folder) => restoreFolder.mutate(folder.id)}
          onDropProject={dropOnFolder}
        />
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
              <Button
                type="button"
                onClick={() =>
                  openProjectCreate(
                    selection !== 'all' && selection !== 'none' ? { portfolioId: selection } : {},
                  )
                }
              >
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
                  activeClassName={SEGMENTED_ACTIVE_TONAL}
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
            rowDrag={(project) =>
              canDragProject(project, canManageAny)
                ? {
                    draggable: true,
                    onDragStart: (event) => {
                      event.dataTransfer?.setData('text/plain', project.id);
                      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                      setDraggingId(project.id);
                    },
                    onDragEnd: () => setDraggingId(null),
                  }
                : undefined
            }
            label={ui.projects.title}
            emptyTitle={filtering ? ui.projects.journalEmptyFiltered : ui.projects.journalEmpty}
          />
        </div>
      </div>

      <ProjectArchiveDialog
        name={archiveTarget?.name ?? null}
        open={archiveTarget !== null}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          if (archiveTarget) {
            statusMutation.mutate({ id: archiveTarget.id, status: 'archived' });
          }
          setArchiveTarget(null);
        }}
      />
      <PortfolioRenameDialog
        folder={renameFolderTarget}
        onCancel={() => setRenameFolderTarget(null)}
        onConfirm={(name) => {
          if (renameFolderTarget) renameFolder.mutate({ id: renameFolderTarget.id, name });
          setRenameFolderTarget(null);
        }}
      />
      <PortfolioArchiveDialog
        folder={archiveFolderTarget}
        onCancel={() => setArchiveFolderTarget(null)}
        onConfirm={() => {
          if (archiveFolderTarget) archiveFolder.mutate(archiveFolderTarget.id);
          setArchiveFolderTarget(null);
        }}
      />
    </div>
  );
}
