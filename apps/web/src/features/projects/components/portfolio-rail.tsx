import { useState, type ReactNode } from 'react';
import { Folder, FolderOpen, Inbox, Plus } from 'lucide-react';
import type { ProjectStatus } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { SEGMENTED_ACTIVE_TONAL } from '../../../shared/ui/segmented-control.js';
import { RowMenu, type RowMenuItem } from '../../../shared/views/row-menu.js';
import {
  folderStatusRows,
  totalOf,
  type PortfolioFolder,
  type PortfolioFolderTree,
} from '../lib/portfolio-folders.js';
import { PortfolioCreateField } from './portfolio-create-field.js';

export type FolderSelection = string;

export interface PortfolioRailProps {
  tree: PortfolioFolderTree;
  /** Выбранная папка: `all`, `none` или uuid портфеля. */
  selection: FolderSelection;
  /** Фильтр статуса внутри папки (`all` — все статусы). */
  status: ProjectStatus | 'all';
  canCreate: boolean;
  /** Переименование/архив/возврат — `project.manage` (сервер — истина). */
  canManage: boolean;
  /** Подпись строки «все проекты»: в режиме «Мои» — «Мои проекты» (#559). */
  allLabel?: string;
  /** Проект, который сейчас тащат (null — перетаскивания нет). */
  draggingProjectId: string | null;
  onCreate: (name: string) => void;
  onSelect: (folder: FolderSelection) => void;
  onStatus: (status: ProjectStatus | 'all') => void;
  onRename: (folder: PortfolioFolder) => void;
  onArchive: (folder: PortfolioFolder) => void;
  onRestore: (folder: PortfolioFolder) => void;
  /** Бросок проекта на папку: `none` — убрать из портфеля. */
  onDropProject: (folder: FolderSelection) => void;
}

/** Как показывать число справа: «действует / всего» или только всего. */
type CounterMode = 'ratio' | 'total';

/**
 * Левая колонка журнала «Проекты» — папки-портфели (#559, ADR-0030 доп.
 * 02.11: портфель — ПАПКА журнала, не раздел «Автоматизации»). Строки:
 * «Все проекты», живые портфели со счётчиками (действует / всего), «Без
 * портфеля»; архивные папки — последним блоком и только пока в них остались
 * видимые проекты. Выбранная папка раскрывает строки статусов «действует /
 * завершён / в архиве» — тот же серверный фильтр журнала. Перетаскивание
 * проекта на папку — смена портфеля (права правки проекта проверяет сервер).
 */
export function PortfolioRail({
  tree,
  selection,
  status,
  canCreate,
  canManage,
  allLabel = ui.projects.portfolioAllProjects,
  draggingProjectId,
  onCreate,
  onSelect,
  onStatus,
  onRename,
  onArchive,
  onRestore,
  onDropProject,
}: PortfolioRailProps) {
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const selectedFolder =
    [...tree.active, ...tree.archived].find((folder) => folder.id === selection) ??
    (selection === 'none' ? tree.unassigned : null);

  /** Папка принимает бросок: живая (или «Без портфеля»), но не «Все». */
  const droppable = (folder: PortfolioFolder) =>
    draggingProjectId !== null && !folder.archived && folder.id !== 'all';

  const dropProps = (folder: PortfolioFolder) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!droppable(folder)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      setDragOver(folder.id);
    },
    onDragLeave: () => setDragOver((current) => (current === folder.id ? null : current)),
    onDrop: (event: React.DragEvent) => {
      if (!droppable(folder)) return;
      event.preventDefault();
      setDragOver(null);
      onDropProject(folder.id);
    },
  });

  const menuOf = (folder: PortfolioFolder): RowMenuItem[] => {
    // Псевдо-строки «Все проекты» / «Без портфеля» — не портфели: у них нет
    // id для PATCH/DELETE (запрос ушёл бы в /projects/groups/all → 400).
    if (!canManage || folder.portfolioId === null) return [];
    return [
      { id: 'rename', label: ui.projects.portfolioRename, onSelect: () => onRename(folder) },
      folder.archived
        ? { id: 'restore', label: ui.projects.portfolioRestore, onSelect: () => onRestore(folder) }
        : { id: 'archive', label: ui.projects.portfolioArchive, onSelect: () => onArchive(folder) },
    ];
  };

  const folderRow = (folder: PortfolioFolder, name: string, icon: ReactNode, mode: CounterMode) => {
    const items = menuOf(folder);
    return (
      <div
        role="button"
        tabIndex={0}
        aria-current={selection === folder.id ? 'true' : undefined}
        onClick={() => onSelect(folder.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(folder.id);
          }
        }}
        {...dropProps(folder)}
        className={cn(
          'group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring',
          selection === folder.id
            ? SEGMENTED_ACTIVE_TONAL
            : 'text-foreground/85 hover:bg-accent/50 hover:text-foreground',
          droppable(folder) && 'ring-1 ring-border/60',
          dragOver === folder.id && 'ring-ring',
        )}
      >
        <span aria-hidden className="shrink-0 text-muted-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate" title={name}>
          {name}
        </span>
        <span
          className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
          title={ui.projects.portfolioCountsHint
            .replace('{active}', String(folder.counters.active))
            .replace('{total}', String(totalOf(folder.counters)))}
        >
          {mode === 'total'
            ? totalOf(folder.counters)
            : `${folder.counters.active} / ${totalOf(folder.counters)}`}
        </span>
        {items.length > 0 ? (
          <span className="shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <RowMenu items={items} />
          </span>
        ) : null}
      </div>
    );
  };

  const statusRows = (folder: PortfolioFolder, label: string) =>
    selectedFolder?.id === folder.id && totalOf(folder.counters) > 0 ? (
      <div className="mb-1 flex flex-col gap-0.5 pl-4" role="group" aria-label={label}>
        {folderStatusRows(folder).map((row) => {
          const active = status === row.status;
          return (
            <button
              key={row.status}
              type="button"
              aria-pressed={active}
              onClick={() => onStatus(active ? 'all' : row.status)}
              className={cn(
                'flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                active
                  ? SEGMENTED_ACTIVE_TONAL
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{ui.projects.status[row.status]}</span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums">{row.count}</span>
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <aside
      aria-label={ui.projects.portfoliosTitle}
      className="flex w-60 shrink-0 flex-col gap-1 self-start rounded-xl bg-muted/40 p-2"
    >
      <div className="flex h-8 items-center justify-between gap-2 pr-0.5 pl-2">
        <NodeLabel label={ui.projects.portfoliosTitle} />
        {canCreate ? (
          <button
            type="button"
            aria-label={ui.projects.portfolioCreate}
            title={ui.projects.portfolioCreate}
            onClick={() => setCreating(true)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      {creating ? (
        <PortfolioCreateField
          onCancel={() => setCreating(false)}
          onSubmit={(name) => {
            onCreate(name);
            setCreating(false);
          }}
        />
      ) : null}

      <div role="group" className="flex flex-col gap-0.5">
        {folderRow(
          tree.all,
          allLabel,
          <FolderOpen className="size-3.5" strokeWidth={1.75} />,
          'total',
        )}
        {tree.active.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">{ui.projects.portfolioEmpty}</p>
        ) : null}
        {tree.active.map((folder) => (
          <div key={folder.id}>
            {folderRow(
              folder,
              folder.name,
              <Folder className="size-3.5" strokeWidth={1.75} />,
              'ratio',
            )}
            {statusRows(folder, folder.name)}
          </div>
        ))}
        {folderRow(
          tree.unassigned,
          ui.projects.portfolioNone,
          <Inbox className="size-3.5" strokeWidth={1.75} />,
          'ratio',
        )}
        {statusRows(tree.unassigned, ui.projects.portfolioNone)}
      </div>

      {tree.archived.length > 0 ? (
        <div className="mt-2 flex flex-col gap-0.5">
          <div className="flex h-6 items-center pl-2">
            <NodeLabel label={ui.projects.portfolioArchivedSection} />
          </div>
          {tree.archived.map((folder) => (
            <div key={folder.id}>
              {folderRow(
                folder,
                folder.name,
                <Folder className="size-3.5" strokeWidth={1.75} />,
                'ratio',
              )}
              {statusRows(folder, folder.name)}
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
