import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { Archive, ArchiveRestore, Copy, MoreHorizontal, Settings2 } from 'lucide-react';

/** Триггер «⋯» строки единой колонки (по ховеру строки). */
export function RowMenuTrigger() {
  return (
    <DropdownMenuTrigger
      aria-label={ui.common.rowMenu}
      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <MoreHorizontal className="size-4" strokeWidth={1.75} />
    </DropdownMenuTrigger>
  );
}

function ArchiveItem({
  archived,
  restoreLabel,
  archiveLabel,
  onToggle,
}: {
  archived: boolean;
  restoreLabel: string;
  archiveLabel: string;
  onToggle: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onToggle}>
      {archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
      {archived ? restoreLabel : archiveLabel}
    </DropdownMenuItem>
  );
}

/** Меню строки задачи/письма: настройки, копия (только задачи — каталог
 *  писем заморожен, #55), архив/возврат. */
export function ProcessRowMenu({
  isTask,
  isSystem,
  archived,
  onOpenSettings,
  onCopy,
  onArchive,
  onRestore,
}: {
  isTask: boolean;
  isSystem: boolean;
  archived: boolean;
  onOpenSettings: () => void;
  onCopy: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <DropdownMenu>
      <RowMenuTrigger />
      <DropdownMenuContent align="end" className="w-52">
        {!archived ? (
          <>
            <DropdownMenuItem onSelect={onOpenSettings}>
              <Settings2 className="size-3.5" />
              {ui.automation.typeSettings.title}
            </DropdownMenuItem>
            {isTask ? (
              <DropdownMenuItem onSelect={onCopy}>
                <Copy className="size-3.5" />
                {ui.automation.menuCopyType}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          disabled={isSystem}
          title={isSystem ? ui.automation.archiveSystemLocked : undefined}
          onSelect={archived ? onRestore : onArchive}
        >
          {archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
          {archived ? ui.automation.restoreFromArchive : ui.automation.menuArchive}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Меню строки типа проекта: настройки, копия, архив/возврат. */
export function ProjectRowMenu({
  archived,
  onOpenSettings,
  onCopy,
  onArchive,
  onRestore,
}: {
  archived: boolean;
  onOpenSettings: () => void;
  onCopy: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <DropdownMenu>
      <RowMenuTrigger />
      <DropdownMenuContent align="end" className="w-52">
        {!archived ? (
          <>
            <DropdownMenuItem onSelect={onOpenSettings}>
              <Settings2 className="size-3.5" />
              {ui.projects.schemasTypeSettings}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCopy}>
              <Copy className="size-3.5" />
              {ui.automation.menuCopyType}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <ArchiveItem
          archived={archived}
          restoreLabel={ui.projects.typesRestore}
          archiveLabel={ui.projects.typesArchive}
          onToggle={archived ? onRestore : onArchive}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Меню строки типа папки: клик уже открывает экран — из меню только
 *  копия и архив/возврат. */
export function KindRowMenu({
  archived,
  onCopy,
  onArchive,
  onRestore,
}: {
  archived: boolean;
  onCopy: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <DropdownMenu>
      <RowMenuTrigger />
      <DropdownMenuContent align="end" className="w-52">
        {!archived ? (
          <>
            <DropdownMenuItem onSelect={onCopy}>
              <Copy className="size-3.5" />
              {ui.automation.menuCopyType}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <ArchiveItem
          archived={archived}
          restoreLabel={ui.nodeKinds.restore}
          archiveLabel={ui.nodeKinds.panel.archive}
          onToggle={archived ? onRestore : onArchive}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
