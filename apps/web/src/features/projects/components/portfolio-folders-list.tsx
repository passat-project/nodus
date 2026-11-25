import { Fragment } from 'react';
import { Check, Folder, FolderOpen, Inbox } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { RowMenu, type RowMenuItem } from '../../../shared/views/row-menu.js';
import type { PortfolioFolder, PortfolioFolderTree } from '../lib/portfolio-folders.js';

/** Общий класс внутренней кнопки строки списка папок. */
const ROW =
  'flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring';

/** Слот галочки — постоянный: галочки всех строк стоят на одной линии. */
function CheckSlot({ active }: { active: boolean }) {
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center">
      {active ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
    </span>
  );
}

export interface PortfolioFoldersListProps {
  tree: PortfolioFolderTree;
  /** Выбранная папка: `all`, `none` или uuid портфеля. */
  selection: string;
  /** Подпись «Все проекты»: в режиме «Мои» — «Мои проекты» (#559). */
  allLabel: string;
  /** Права на переименование/удаление портфеля (`project.manage`). */
  canManage: boolean;
  onSelect: (folder: string) => void;
  /** Настройка портфеля прямо в строке списка («⋯» у папки). */
  onRename: (folder: PortfolioFolder) => void;
  /** Удаление портфеля навсегда: проекты перейдут в «Без портфеля». */
  onDelete: (folder: PortfolioFolder) => void;
}

/**
 * Тело списка «Портфели» (#559): «Все проекты», портфели и «Без портфеля».
 * Счётчиков у папок нет (вердикт владельца 16.11.2026: цифры «2 / 2» в
 * поповере — лишний шум; счётчики живут в журнале/дашбордах).
 * Архива у папки нет (13.11.2026) — удаление сразу навсегда.
 * Строка — настоящая кнопка: Enter/Space и фокус-ринг — от браузера.
 * У каждой папки на месте — «⋯» с настройкой (переименовать/удалить), как в
 * Битрикс24: настройка живёт в самом списке, отдельного экрана не нужно.
 * Папки — только выбор фильтра и настройка; бросок строки проекта сюда убран
 * (#1014, решение владельца 24.11.2026).
 */
export function PortfolioFoldersList({
  tree,
  selection,
  allLabel,
  canManage,
  onSelect,
  onRename,
  onDelete,
}: PortfolioFoldersListProps) {
  const folderRow = (folder: PortfolioFolder, name: string) => {
    const active = selection === folder.id;
    const icon =
      folder.id === 'all' ? (
        <FolderOpen className="size-3.5" strokeWidth={1.75} />
      ) : folder.portfolioId === null ? (
        <Inbox className="size-3.5" strokeWidth={1.75} />
      ) : (
        <Folder className="size-3.5" strokeWidth={1.75} />
      );
    // Настройка портфеля — прямо в строке списка (как в Битрикс24): меню
    // «⋯» открывает переименование/удаление без выбора папки.
    const items: RowMenuItem[] =
      canManage && folder.portfolioId !== null
        ? [
            {
              id: 'rename',
              label: ui.projects.portfolioRename,
              onSelect: () => onRename(folder),
            },
            {
              id: 'delete',
              label: ui.projects.portfolioDelete,
              danger: true,
              separatorBefore: true,
              onSelect: () => onDelete(folder),
            },
          ]
        : [];
    return (
      <div
        key={folder.id}
        data-folder-row={folder.id}
        className={cn(
          'group flex h-8 w-full items-center rounded-md transition-colors',
          active ? 'bg-accent' : 'hover:bg-accent/50',
        )}
      >
        <button
          type="button"
          aria-current={active ? 'true' : undefined}
          title={name}
          onClick={() => onSelect(folder.id)}
          className={ROW}
        >
          <span aria-hidden className="shrink-0 text-muted-foreground">
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <CheckSlot active={active} />
        </button>
        {/* Слот меню постоянный: галочки всех строк на одной линии. */}
        <span className="mr-0.5 flex size-6 shrink-0 items-center justify-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {items.length > 0 ? <RowMenu items={items} align="end" /> : null}
        </span>
      </div>
    );
  };

  const hasFolders = tree.folders.length > 0;

  return (
    <div className="max-h-80 overflow-y-auto p-1">
      {folderRow(tree.all, allLabel)}
      {tree.folders.map((folder) => (
        <Fragment key={folder.id}>{folderRow(folder, folder.name)}</Fragment>
      ))}
      {hasFolders ? (
        <Fragment key="unassigned">
          {folderRow(tree.unassigned, ui.projects.portfolioNone)}
        </Fragment>
      ) : (
        <p className="px-2 py-1 text-xs text-muted-foreground">{ui.projects.portfolioEmpty}</p>
      )}
    </div>
  );
}
