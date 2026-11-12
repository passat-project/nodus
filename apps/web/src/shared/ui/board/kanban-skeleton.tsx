import { Skeleton } from '@nodus/ui/components/skeleton';

import { cn } from '@nodus/ui/lib/utils';

import { BOARD_COLUMN_CLASS, BOARD_ROW_CLASS } from './board-metrics.js';

/** Скелетон канбан-доски — единый для всех досок (аудит #45: копии в
 *  task/project канбанах разъехались классами). className — классы
 *  контейнера СВОЕЙ доски (скелетон зеркалит её геометрию); columns — число
 *  колонок, когда стадии уже известны (иначе 4): доска не «дребезжит»
 *  сменой числа колонок при доливке фидов. Ширина колонки и ряд — из
 *  `board-metrics.ts` (#730): скелетон обязан совпадать с настоящей доской,
 *  иначе при загрузке колонки прыгают. */
export function KanbanSkeleton({
  className,
  columns = 4,
}: {
  className?: string;
  columns?: number;
}) {
  return (
    <div className={cn(BOARD_ROW_CLASS, className)}>
      {Array.from({ length: columns }, (_, i) => i).map((i) => (
        <Skeleton key={i} className={cn('h-full', BOARD_COLUMN_CLASS)} />
      ))}
    </div>
  );
}
