import { useState } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import type { PortfolioFolder } from '../lib/portfolio-folders.js';

/**
 * Окна портфеля-папки журнала (#559): переименование и удаление. Оба —
 * лёгкие действия списка папок, поэтому живут на странице журнала, а не в
 * «Автоматизации» (портфель — папка «Проектов»). Архива у папки нет
 * (13.11.2026): удаление сразу навсегда, проекты переходят в «Без портфеля».
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

/**
 * Подтверждение УДАЛЕНИЯ портфеля навсегда: проекты не удаляются — переходят
 * в «Без портфеля» (связи задач, участников и истории остаются). Необратимо,
 * поэтому окно с явным «Удалить» цвета опасности.
 */
export function PortfolioDeleteDialog({
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
        <DialogTitle>{ui.projects.portfolioDeleteConfirmTitle}</DialogTitle>
        <p className="text-sm text-muted-foreground">{ui.projects.portfolioDeleteConfirmBody}</p>
        <p className="truncate text-sm font-medium">{folder?.name ?? ''}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {ui.projects.portfolioDelete}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {ui.common.cancel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
