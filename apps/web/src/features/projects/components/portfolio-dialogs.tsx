import { useState } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import type { PortfolioFolder } from '../lib/portfolio-folders.js';

/**
 * Окна портфеля-папки журнала (#559): переименование и архивация. Оба —
 * лёгкие действия левой колонки, поэтому живут на странице журнала, а не в
 * «Автоматизации» (портфель — папка «Проектов»). Архив — не удаление: проекты
 * остаются, папку можно вернуть из блока «Архив».
 */
export function PortfolioRenameDialog({
  folder,
  onCancel,
  onConfirm,
}: {
  folder: PortfolioFolder | null;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  return (
    <Dialog open={folder !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md sm:max-w-md" aria-describedby={undefined}>
        <DialogTitle>{ui.projects.portfolioRename}</DialogTitle>
        {/* Форма монтируется вместе с окном: черновик имени свой у каждой
            папки и не переезжает в следующую (сброс при закрытии). */}
        {folder ? <RenameForm folder={folder} onCancel={onCancel} onConfirm={onConfirm} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  folder,
  onCancel,
  onConfirm,
}: {
  folder: PortfolioFolder;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(folder.name);
  const trimmed = name.trim();
  const submit = () => {
    if (trimmed) onConfirm(trimmed);
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label={ui.projects.fieldName}
        placeholder={ui.projects.portfolioNamePlaceholder}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={trimmed === '' || trimmed === folder.name}>
          {ui.common.save}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {ui.common.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Подтверждение архивации портфеля: обычное окно без ввода (клик мимо =
 *  «нет»), как у архивации проекта. */
export function PortfolioArchiveDialog({
  folder,
  onCancel,
  onConfirm,
}: {
  folder: PortfolioFolder | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={folder !== null} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md sm:max-w-md" aria-describedby={undefined}>
        <DialogTitle>{ui.projects.portfolioArchiveConfirmTitle}</DialogTitle>
        <p className="text-sm text-muted-foreground">{ui.projects.portfolioArchiveConfirmBody}</p>
        <p className="truncate text-sm font-medium">{folder?.name ?? ''}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {ui.projects.portfolioArchive}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {ui.common.cancel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
