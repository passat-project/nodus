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

/** Пункт архива строки любого вида — одна подпись с действием окна настроек
 *  («Архивировать тип» / «Вернуть тип»). */
function ArchiveItem({
  archived,
  onToggle,
  disabled,
  lockedTitle,
}: {
  archived: boolean;
  onToggle: () => void;
  /** Системный тип в архив не убирается: пункт выключен, пояснение — в `title`. */
  disabled?: boolean;
  lockedTitle?: string;
}) {
  return (
    <DropdownMenuItem disabled={disabled} title={lockedTitle} onSelect={onToggle}>
      {archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
      {archived ? ui.common.typeSettings.restore : ui.common.typeSettings.archive}
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
              {ui.automation.menuSettingsType}
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
        <ArchiveItem
          archived={archived}
          onToggle={archived ? onRestore : onArchive}
          disabled={isSystem}
          lockedTitle={isSystem ? ui.automation.archiveSystemLocked : undefined}
        />
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
              {ui.automation.menuSettingsType}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCopy}>
              <Copy className="size-3.5" />
              {ui.automation.menuCopyType}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <ArchiveItem archived={archived} onToggle={archived ? onRestore : onArchive} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Меню строки типа папки: клик уже открывает экран — из меню только
 *  копия и архив/возврат. */
export function KindRowMenu({
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
              {ui.automation.menuSettingsType}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCopy}>
              <Copy className="size-3.5" />
              {ui.automation.menuCopyType}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <ArchiveItem archived={archived} onToggle={archived ? onRestore : onArchive} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
