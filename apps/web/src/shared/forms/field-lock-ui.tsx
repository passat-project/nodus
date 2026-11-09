import { useRef, useState } from 'react';
import type { FieldLockedDetails, TaskFieldLock } from '@nodus/contracts';
import { ErrorCode, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { Textarea } from '@nodus/ui/components/textarea';
import { Lock } from 'lucide-react';

import { ApiError } from '../api-client.js';
import { formatDateTime } from '../lib/format.js';

const l = ui.forms.locks;

/** Тост отказа замка (#496): поле закреплено / только постановщик / нужна
 *  причина — текст по `details.reason` 422 `FIELD_LOCKED`. */
export function fieldLockedText(failure: unknown): string | null {
  if (!(failure instanceof ApiError) || failure.code !== ErrorCode.FIELD_LOCKED) return null;
  const reason = (failure.details as Partial<FieldLockedDetails> | undefined)?.reason;
  return reason ? l.denied[reason] : l.denied.locked;
}

/** Правка закреплённого поля: без замка — сразу; с `canEdit` — через окно
 *  причины. Возвращает флаг доступности и готовое окно причины. */
export function useFieldLock(lock: TaskFieldLock | undefined) {
  const [open, setOpen] = useState(false);
  const pending = useRef<((reason: string) => void) | null>(null);
  const request = (action: (reason?: string) => void) => {
    if (lock?.canEdit) {
      pending.current = (reason) => action(reason);
      setOpen(true);
    } else {
      action();
    }
  };
  const dialog = (
    <LockReasonDialog
      open={open}
      onCancel={() => {
        pending.current = null;
        setOpen(false);
      }}
      onConfirm={(reason) => {
        const action = pending.current;
        pending.current = null;
        setOpen(false);
        action?.(reason);
      }}
    />
  );
  return { lock, editable: !lock || lock.canEdit, request, dialog };
}

/** Значок замка у поля карточки (#496): источник, кто и когда закрепил,
 *  последняя правка с причиной. `canEdit` — правило замка без учёта причины
 *  (сервер, Р10): при нём правка возможна через окно причины. */
export function TaskLockBadge({ lock }: { lock: TaskFieldLock }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={l.badge}
          title={l.badge}
          className="shrink-0 rounded p-0.5 text-primary transition-colors hover:bg-accent"
        >
          <Lock className="size-3" strokeWidth={2} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="flex flex-col gap-2 text-xs">
          <p className="text-sm font-medium">
            {lock.source.kind === 'creation'
              ? l.lockedAfterCreation
              : l.lockedAfter(lock.source.name)}
          </p>
          <p className="text-muted-foreground">
            {lock.editors === 'none' ? l.editorsNone : l.editorsOwners}
          </p>
          {lock.lockedBy ? (
            <p className="text-muted-foreground">
              {l.lockedBy}: {lock.lockedBy.displayName} · {formatDateTime(lock.lockedAt)}
            </p>
          ) : null}
          {lock.lastChange ? (
            <div className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-2 py-1.5">
              <span className="text-muted-foreground">{l.lastChange}</span>
              <span>
                {formatDateTime(lock.lastChange.at)} · {lock.lastChange.by.displayName}
              </span>
              <span className="break-words">{lock.lastChange.reason}</span>
            </div>
          ) : null}
          {lock.canEdit ? <p className="text-muted-foreground">{l.canEditHint}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Окно «Причина изменения» (#496): закреплённое правит владелец с причиной
 *  3..500; без причины сервер ответит 422. */
export function LockReasonDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [openedFor, setOpenedFor] = useState(open);
  if (openedFor !== open) {
    setOpenedFor(open);
    if (open) setReason('');
  }
  const valid = reason.trim().length >= 3;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogTitle className="text-base font-medium">{l.reasonTitle}</DialogTitle>
        <p className="text-sm text-muted-foreground">{l.reasonLead}</p>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, 500))}
          placeholder={l.reasonPlaceholder}
          aria-label={l.reasonTitle}
          className="min-h-16 text-sm"
        />
        {!valid && reason.length > 0 ? (
          <p className="text-xs text-danger">{l.reasonShort}</p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {ui.common.cancel}
          </Button>
          <Button type="button" disabled={!valid} onClick={() => onConfirm(reason.trim())}>
            {l.reasonSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
