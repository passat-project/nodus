import { CalendarClock } from 'lucide-react';
import { isOpenState, ui, type TaskSystemState } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { formatDateTime } from '../lib/format.js';

/** Чип срока: просрочен — красный, сегодня — оранжевый, далее — нейтральный.
 *  Срочность — только пока работа не сдана (фаза open): у задачи на
 *  утверждении и закрытой срок нейтральный (ADR-0020, дополнение 2). */
export function DeadlineChip({
  deadline,
  state,
  className,
}: {
  deadline: string | null;
  /** Системное состояние задачи — решает, горит ли срок. */
  state: TaskSystemState;
  className?: string;
}) {
  if (!deadline) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>{ui.common.noDeadline}</span>
    );
  }
  const date = new Date(deadline);
  const now = new Date();
  const dayEnd = new Date();
  dayEnd.setHours(23, 59, 59, 999);
  const urgent = isOpenState(state);
  const overdue = urgent && date < now;
  const today = urgent && !overdue && date <= dayEnd;

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 overflow-hidden rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums',
        overdue && 'bg-danger-soft text-danger',
        today && 'bg-warning-soft text-warning',
        !overdue && !today && 'bg-muted text-muted-foreground',
        className,
      )}
    >
      <CalendarClock className="size-3.5 shrink-0" />
      <span className="truncate">{formatDateTime(deadline)}</span>
      {/* Просрочка — красный чип; слово нужно только скринридеру, зрячему
          оно ломало срок на две строки. */}
      {overdue ? <span className="sr-only">, {ui.tasks.overdue}</span> : null}
    </span>
  );
}
