import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderTree, Plus } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { PortfolioCreateField } from './portfolio-create-field.js';
import { PortfolioFoldersList } from './portfolio-folders-list.js';
import {
  folderLabel,
  type PortfolioFolder,
  type PortfolioFolderTree,
} from '../lib/portfolio-folders.js';

export type FolderSelection = string;

export interface PortfolioMenuProps {
  tree: PortfolioFolderTree;
  /** Выбранная папка: `all`, `none` или uuid портфеля. */
  selection: FolderSelection;
  canCreate: boolean;
  /** Переименование/удаление — `project.manage` (сервер — истина). */
  canManage: boolean;
  /** Подпись «Все проекты»: в режиме «Мои» — «Мои проекты» (#559). */
  allLabel?: string;
  /** Проект, который сейчас тащат (null — перетаскивания нет). */
  draggingProjectId: string | null;
  onCreate: (name: string) => void;
  onSelect: (folder: FolderSelection) => void;
  onRename: (folder: PortfolioFolder) => void;
  /** Удаление портфеля навсегда: проекты перейдут в «Без портфеля». */
  onDelete: (folder: PortfolioFolder) => void;
  /** Бросок проекта на папку: `none` — убрать из портфеля. */
  onDropProject: (folder: FolderSelection) => void;
}

/**
 * «Портфели» — кнопка журнала «Проекты» в строке инструментов, сразу после
 * «Создать» (как в Битрикс24; решения 02.11 и 16.11.2026: портфель — ПАПКА
 * журнала, но отдельная колонка отбирала у таблицы место). Список папок живёт
 * в поповере той же композиции, что прежняя панель: шапка «ПОРТФЕЛИ» с «+»,
 * строки с иконками и счётчиками (действует / всего), «Без портфеля»; у каждой
 * папки — «⋯» с настройкой (переименовать/удалить) прямо в списке. Клик по
 * строке — серверный фильтр `portfolioId` журнала.
 *
 * Подпись кнопки (вердикт владельца 13.11.2026): выбранная папка называет саму
 * кнопку — «Портфели» по умолчанию, имя портфеля после выбора; в строке
 * фильтров выбранная папка НЕ дублируется чипом. Вид кнопки не меняется:
 * постоянный нейтральный стиль, без подсветки выбора (её видно галочкой в
 * списке).
 *
 * Перетаскивание проекта на папку сохранено: пока строку тащат, список
 * открывается сам и служит целью броска (закрывается на dragend).
 */
export function PortfolioMenu({
  tree,
  selection,
  canCreate,
  canManage,
  allLabel = ui.projects.portfolioAllProjects,
  draggingProjectId,
  onCreate,
  onSelect,
  onRename,
  onDelete,
  onDropProject,
}: PortfolioMenuProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const openedByDrag = useRef(false);

  // Перетаскивание проекта: папки — цель броска, поэтому поповер открывается
  // сам и закрывается, когда строку отпустили.
  useEffect(() => {
    if (draggingProjectId !== null) {
      setOpen(true);
      openedByDrag.current = true;
    } else if (openedByDrag.current) {
      openedByDrag.current = false;
      setOpen(false);
    }
  }, [draggingProjectId]);

  // Список закрыли — незавершённое создание не должно «висеть» до следующего
  // открытия.
  useEffect(() => {
    if (!open) setCreating(false);
  }, [open]);

  const selectFolder = (folder: FolderSelection) => {
    onSelect(folder);
    setOpen(false);
  };
  /** Настройка папки из строки списка: поповер закрывается, открывается окно. */
  const setupFolder = (run: (folder: PortfolioFolder) => void) => (folder: PortfolioFolder) => {
    setOpen(false);
    run(folder);
  };

  // Подпись кнопки: имя выбранной папки; «Портфели» — когда фильтра нет.
  const triggerLabel =
    selection === tree.all.id
      ? ui.projects.portfoliosTitle
      : folderLabel(tree, selection, { all: allLabel, none: ui.projects.portfolioNone });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${ui.projects.portfoliosTitle}: ${triggerLabel}`}
          aria-expanded={open}
          title={triggerLabel}
          className="flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30"
        >
          <FolderTree className="size-3.5 shrink-0" aria-hidden />
          <span className="max-w-52 truncate">{triggerLabel}</span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-150',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        // Пока тащат строку, поповер — цель броска: фокус уходит на строку, и
        // без этого «focus outside» закрыл бы список на первом кадре drag.
        // Меню «⋯» у папки — собственный поповер в портале: его клики и фокус
        // не должны закрывать список портфелей.
        onFocusOutside={(event) => {
          if (draggingProjectId !== null) event.preventDefault();
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-radix-popper-content-wrapper]')) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (draggingProjectId !== null) event.preventDefault();
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-radix-popper-content-wrapper]')) event.preventDefault();
        }}
      >
        <div className="flex h-9 items-center justify-between gap-2 border-b border-border/60 pr-1 pl-2">
          <NodeLabel label={ui.projects.portfoliosTitle} />
          {canCreate ? (
            <button
              type="button"
              aria-label={ui.projects.portfolioCreate}
              title={ui.projects.portfolioCreate}
              onClick={() => setCreating(true)}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
        </div>

        {creating ? (
          <div className="border-b border-border/60 p-1">
            <PortfolioCreateField
              onCancel={() => setCreating(false)}
              onSubmit={(name) => {
                onCreate(name);
                setCreating(false);
                setOpen(false);
              }}
            />
          </div>
        ) : null}

        <PortfolioFoldersList
          tree={tree}
          selection={selection}
          allLabel={allLabel}
          canManage={canManage}
          draggingProjectId={draggingProjectId}
          onSelect={selectFolder}
          onRename={setupFolder(onRename)}
          onDelete={setupFolder(onDelete)}
          onDropProject={onDropProject}
        />
      </PopoverContent>
    </Popover>
  );
}
