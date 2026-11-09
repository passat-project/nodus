import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { TaskDetail, TaskPriority } from '@nodus/contracts';
import { isOpenState, taskPrioritySchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { toast } from 'sonner';

import { useFieldLock } from '../../../shared/forms/field-lock-ui.js';
import { DateTimePicker } from '../../../shared/ui/date-time-picker.js';
import { DeadlineChip } from '../../../shared/ui/deadline-chip.js';
import { priorityTone } from '../../../shared/views/task-table-fields.js';
import { useShiftSubtaskDeadlines, useUpdateTask } from '../api/task-edit-api.js';
import { formatDuration, parseDuration } from '../../../shared/lib/minutes.js';
import type { TaskFieldLock } from '@nodus/contracts';

/** Кликабельное значение поля: та же строка, ховер-подложка (без рамок —
 *  канон полей-строк карточки). */
const valueButton =
  '-mx-1 inline-flex h-6 max-w-full items-center gap-1 rounded-md px-1 transition-colors hover:bg-accent';

/** Срок: чип — триггер календаря (DateTimePicker). Сдвиг срока родителя
 *  предлагает сдвинуть сроки открытых подзадач на тот же интервал (каскад
 *  #311, модель MS Project/Битрикс24 «сдвинуть связанные»). */
/** Срок карточки. `required` — обязательное при создании поле типа (#432):
 *  очистка недоступна, сервер ответил бы 422. */
export function TaskDeadlineField({
  task,
  required = false,
  lock,
}: {
  task: TaskDetail;
  required?: boolean;
  /** Замок срока (#496): без `canEdit` — только чтение, иначе причина. */
  lock?: TaskFieldLock;
}) {
  const update = useUpdateTask(task.id);
  const shift = useShiftSubtaskDeadlines();
  const { editable, request, dialog } = useFieldLock(lock);
  const [cascade, setCascade] = useState<{ id: string; deadline: string }[] | null>(null);

  if (!task.access.canEdit || !editable) {
    return <DeadlineChip deadline={task.deadline} state={task.stage.systemState} />;
  }

  function onChange(next: Date | null) {
    const deadline = next?.toISOString() ?? null;
    if (required && deadline === null) return;
    if (deadline === task.deadline) return;
    request((reason) => {
      update.mutate({ deadline, ...(reason ? { lockReason: reason } : {}) });
      if (!next || !task.deadline) return;
      const delta = next.getTime() - Date.parse(task.deadline);
      const moved = task.subtasks
        .filter((s) => s.deadline && isOpenState(s.stage.systemState))
        .map((s) => ({
          id: s.id,
          deadline: new Date(Date.parse(s.deadline ?? '') + delta).toISOString(),
        }));
      if (moved.length > 0 && delta !== 0) setCascade(moved);
    });
  }

  return (
    <>
      {dialog}
      <DateTimePicker
        value={task.deadline ? new Date(task.deadline) : null}
        onChange={onChange}
        ariaLabel={ui.tasks.deadline}
        clearLabel={required ? undefined : ui.tasks.removeDeadline}
      >
        <button type="button" className={valueButton}>
          <DeadlineChip deadline={task.deadline} state={task.stage.systemState} />
        </button>
      </DateTimePicker>
      <Dialog open={cascade !== null} onOpenChange={(open) => !open && setCascade(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{ui.tasks.cascadeTitle}</DialogTitle>
            <DialogDescription>{ui.tasks.cascadeText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCascade(null)}>
              {ui.tasks.cascadeKeep}
            </Button>
            <Button
              onClick={() => {
                if (cascade) shift.mutate(cascade);
                setCascade(null);
              }}
            >
              {ui.tasks.cascadeShift} · {cascade?.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TaskPriorityField({ task, lock }: { task: TaskDetail; lock?: TaskFieldLock }) {
  const update = useUpdateTask(task.id);
  const { editable, request, dialog } = useFieldLock(lock);
  const chip = (
    <NodeChip tone={priorityTone[task.priority]}>{ui.tasks.priority[task.priority]}</NodeChip>
  );
  if (!task.access.canEdit || !editable) return chip;
  return (
    <>
      {dialog}
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={ui.tasks.fieldPriority} className={valueButton}>
          {chip}
          <ChevronDown className="size-3 text-muted-foreground" strokeWidth={1.75} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {taskPrioritySchema.options.map((p: TaskPriority) => (
            <DropdownMenuItem
              key={p}
              onSelect={() =>
                p !== task.priority &&
                request((reason) =>
                  update.mutate({ priority: p, ...(reason ? { lockReason: reason } : {}) }),
                )
              }
            >
              <NodeChip tone={priorityTone[p]}>{ui.tasks.priority[p]}</NodeChip>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Плановое время: текст «2 ч 30 м», правка — ввод в деловой форме. */
export function TaskPlannedField({ task, lock }: { task: TaskDetail; lock?: TaskFieldLock }) {
  const update = useUpdateTask(task.id);
  const { editable, request, dialog } = useFieldLock(lock);
  const [draft, setDraft] = useState<string | null>(null);
  const shown =
    task.plannedMinutes !== null
      ? formatDuration(task.plannedMinutes, ui.tasks.hoursShort, ui.tasks.minutesShort)
      : ui.common.notSet;
  const text = <span className="font-mono text-label-sm tabular-nums">{shown}</span>;
  if (!task.access.canEdit || !editable) return text;

  function commit() {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    if (!raw) {
      if (task.plannedMinutes !== null) {
        request((reason) =>
          update.mutate({ plannedMinutes: null, ...(reason ? { lockReason: reason } : {}) }),
        );
      }
      return;
    }
    const minutes = parseDuration(raw);
    if (minutes === null) toast.error(ui.tasks.minutesInvalid);
    else if (minutes !== task.plannedMinutes) {
      request((reason) =>
        update.mutate({ plannedMinutes: minutes, ...(reason ? { lockReason: reason } : {}) }),
      );
    }
  }

  return (
    <>
      {dialog}
      {draft !== null ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setDraft(null);
            }
          }}
          placeholder={ui.tasks.plannedPlaceholder}
          aria-label={ui.tasks.plannedTime}
          className="-mx-1 h-6 w-36 rounded-md bg-accent/50 px-1 font-mono text-label-sm outline-none"
        />
      ) : (
        <button
          type="button"
          className={valueButton}
          onClick={() =>
            setDraft(
              task.plannedMinutes !== null
                ? formatDuration(task.plannedMinutes, ui.tasks.hoursShort, ui.tasks.minutesShort)
                : '',
            )
          }
        >
          {text}
        </button>
      )}
    </>
  );
}
