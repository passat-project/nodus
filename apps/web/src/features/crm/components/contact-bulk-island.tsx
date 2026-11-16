import { Archive, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { cn } from '@nodus/ui/lib/utils';

import { BulkIsland, bulkActionClass } from '../../../shared/views/bulk-island.js';
import { useBulkContacts } from '../api/counterparty-edit.js';

/**
 * Островок массовых действий вкладки «Контакты» (#460) — тот же общий каркас
 * `shared/views/bulk-island`, что у реестра контрагентов и журнала задач
 * (одна механика во всех списочных представлениях). Действия зависят от
 * выделения: «В архив» — если среди выбранных есть действующие, «Из архива» —
 * если есть архивные, «Удалить» — всегда. Удаление необратимо — только через
 * диалог с числом записей и фокусом на «Отмена» (#866, AUD-027).
 */
export function ContactBulkIsland({
  counterpartyId,
  selectedIds,
  hasActive,
  hasArchived,
  visible,
  onClear,
}: {
  counterpartyId: string;
  selectedIds: readonly string[];
  hasActive: boolean;
  hasArchived: boolean;
  visible: boolean;
  onClear: () => void;
}) {
  const bulk = useBulkContacts(counterpartyId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = (action: 'archive' | 'restore') =>
    bulk.mutate({ ids: selectedIds, action }, { onSuccess: () => onClear() });

  const confirmDeleteNow = () =>
    bulk.mutate(
      { ids: selectedIds, action: 'delete' },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          onClear();
        },
      },
    );

  return (
    <>
      <BulkIsland
        visible={visible}
        count={selectedIds.length}
        ariaLabel={ui.counterparties.contactPersons}
        pending={bulk.isPending}
        onClear={onClear}
      >
        {hasActive ? (
          <button
            type="button"
            className={bulkActionClass}
            tabIndex={visible ? 0 : -1}
            disabled={bulk.isPending}
            onClick={() => run('archive')}
          >
            <Archive className="size-4" strokeWidth={1.75} />
            {ui.counterparties.bulkArchive}
          </button>
        ) : null}
        {hasArchived ? (
          <button
            type="button"
            className={bulkActionClass}
            tabIndex={visible ? 0 : -1}
            disabled={bulk.isPending}
            onClick={() => run('restore')}
          >
            <RotateCcw className="size-4" strokeWidth={1.75} />
            {ui.counterparties.bulkRestore}
          </button>
        ) : null}
        <button
          type="button"
          className={cn(
            bulkActionClass,
            'text-destructive hover:bg-destructive/10 hover:text-destructive',
          )}
          tabIndex={visible ? 0 : -1}
          disabled={bulk.isPending}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-4" strokeWidth={1.75} />
          {ui.counterparties.bulkDelete}
        </button>
      </BulkIsland>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{ui.counterparties.bulkContactDeleteConfirmTitle}</DialogTitle>
            <DialogDescription>
              {ui.counterparties.bulkContactDeleteConfirmText.replace(
                '{n}',
                String(selectedIds.length),
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" autoFocus onClick={() => setConfirmDelete(false)}>
              {ui.common.cancel}
            </Button>
            <Button variant="destructive" disabled={bulk.isPending} onClick={confirmDeleteNow}>
              {ui.counterparties.bulkDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
