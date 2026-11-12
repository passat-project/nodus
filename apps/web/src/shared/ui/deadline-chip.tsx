import { CalendarClock } from 'lucide-react';
import { isOpenState, ui, type TaskSystemState } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { formatDateTime, formatDateTimeCompact } from '../lib/format.js';

/** Чип срока: просрочен — красный, сегодня — оранжевый, далее — нейтральный.
 *  Срочность — только пока работа не сдана (фаза open): у задачи на
 *  утверждении и закрытой срок нейтральный (ADR-0020, дополнение 2).
 *  `compact` — плотный вариант для узкой карточки канбана (#730): дата
 *  короткая («12.11, 14:00»), без плашки у нейтрального срока, и при
 *  отсутствии срока чип не рисуется вовсе (в мета-строке «Без срока» —
 *  лишний шум и место). */
export function DeadlineChip({
  deadline,
  state,
  compact = false,
  className,
}: {
  deadline: string | null;
  /** Системное состояние задачи — решает, горит ли срок. */
  state: TaskSystemState;
  compact?: boolean;
  className?: string;
}) {
  if (!deadline) {
    if (compact) return null;
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

  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex min-w-0 items-center gap-1 rounded px-px text-label-sm whitespace-nowrap tabular-nums',
          overdue && 'bg-danger-soft px-1 font-medium text-danger',
          today && 'bg-warning-soft px-1 font-medium text-warning',
          !overdue && !today && 'text-muted-foreground',
          className,
        )}
      >
        <CalendarClock className="size-3 shrink-0" aria-hidden />
        <span className="truncate" title={formatDateTime(deadline)}>
          {formatDateTimeCompact(deadline)}
        </span>
        {/* Просрочка — красный чип; слово нужно только скринридеру. */}
        {overdue ? <span className="sr-only">, {ui.tasks.overdue}</span> : null}
      </span>
    );
  }

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
