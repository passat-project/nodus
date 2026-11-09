import type { PressRoundView, TaskDetail, WorkflowTransition } from '@nodus/contracts';
import { effectiveWindowSections, PRESS_WINDOW_SECTION_KINDS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Download } from 'lucide-react';

import { useTaskConversation } from '../../../shared/chat/chat-queries.js';
import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { formatDateTimeShort } from '../../../shared/lib/format.js';
import { TransitionWindow } from '../../../shared/workflow/transition-window/transition-window.js';
import { windowContextOf } from './task-transition-dialog.js';
import { transitionWindowError } from '../api/transitions-api.js';
import { useSubmitPress, useWithdrawPress } from '../api/press-api.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { downloadPressCsv, pressStateClass, pressStateLabel } from './task-press-format.js';

/** Есть ли у коллективной кнопки окно: разделы настраиваются в редакторе
 *  окна кнопки (#496), отдельного списка «что заполняет каждый» нет.
 *  Гейты добавляют свои разделы, чтобы участник мог их заполнить — сами
 *  условия проверяются при кворуме. */
export function pressHasWindow(transition: WorkflowTransition | null): boolean {
  if (!transition?.form) return false;
  return effectiveWindowSections(transition.form, {
    validators: transition.validators,
  }).some((section) => (PRESS_WINDOW_SECTION_KINDS as readonly string[]).includes(section.kind));
}

export function PressSubmitDialog({
  task,
  transition,
  open,
  onClose,
}: {
  task: TaskDetail;
  transition: WorkflowTransition;
  open: boolean;
  onClose: () => void;
}) {
  const submit = useSubmitPress(task.id);
  const { data: conversation } = useTaskConversation(task.id);
  const { data: definitions } = useCustomFieldDefinitions('task');

  return (
    <TransitionWindow
      open={open}
      mode="live"
      variant="press"
      transition={transition}
      context={windowContextOf(task, conversation?.id ?? null, definitions ?? [])}
      submitting={submit.isPending}
      error={submit.error ? transitionWindowError(submit.error) : null}
      title={ui.tasks.press.submitTitle}
      submitLabel={ui.tasks.press.send}
      onCancel={onClose}
      onSubmit={(body) => submit.mutate(body.form ?? {}, { onSuccess: onClose })}
    />
  );
}

export function PressAnalyticsDialog({
  taskId,
  press,
  open,
  onClose,
}: {
  taskId: string;
  press: PressRoundView;
  open: boolean;
  onClose: () => void;
}) {
  const withdraw = useWithdrawPress(taskId);

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {ui.tasks.press.analyticsTitle} · {press.pressed}/{press.total}
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto rounded-lg border border-border">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[minmax(0,1.4fr)_100px_120px_minmax(0,1.2fr)] gap-3 border-b border-border px-3 py-2 text-[12px] text-muted-foreground">
              <span>{ui.tasks.press.employee}</span>
              <span>{ui.tasks.press.status}</span>
              <span>{ui.tasks.press.when}</span>
              <span>{ui.tasks.press.result}</span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {press.entries.map((entry) => (
                <div
                  key={entry.userId}
                  className="grid grid-cols-[minmax(0,1.4fr)_100px_120px_minmax(0,1.2fr)] items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <PersonAvatar name={entry.displayName} className="size-6 shrink-0" />
                    <span className="truncate text-sm">{entry.displayName}</span>
                  </span>
                  <span>
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${pressStateClass(entry)}`}
                    >
                      {pressStateLabel(entry)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {entry.pressedAt ? formatDateTimeShort(entry.pressedAt) : '—'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.result?.text || entry.returnReason || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          {press.canWithdraw ? (
            <Button variant="ghost" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
              {ui.tasks.press.withdraw}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => downloadPressCsv(press)}>
            <Download className="size-4" />
            {ui.tasks.press.exportCsv}
          </Button>
          <Button onClick={onClose}>{ui.tasks.press.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
