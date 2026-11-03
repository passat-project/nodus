import type { StageColor } from '@nodus/contracts';

import { NodeChip } from '@nodus/ui/components/node-chip';
import { cn } from '@nodus/ui/lib/utils';

/** Цвет стадии маршрута → тон чипа «Инструмента» (I15: только токены). */
const chipTone: Record<
  StageColor,
  | 'muted'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'violet'
  | 'teal'
  | 'orange'
  | 'pink'
  | 'cyan'
> = {
  neutral: 'muted',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  violet: 'violet',
  teal: 'teal',
  orange: 'orange',
  pink: 'pink',
  cyan: 'cyan',
};

/** Чип стадии по её ЦВЕТУ из маршрута (письма #55: «Ошибочно
 *  зарегистрировано» — закрыта, но красная; тон по системному состоянию —
 *  `TaskStatusBadge` задач). */
export function StageChip({
  name,
  color,
  className,
}: {
  name: string;
  color: StageColor;
  className?: string;
}) {
  return (
    <NodeChip tone={chipTone[color]} className={cn('max-w-full shrink-0', className)}>
      <span className="truncate">{name}</span>
    </NodeChip>
  );
}
