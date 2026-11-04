import { Skeleton } from '@nodus/ui/components/skeleton';

/** Скелетон карточки по форме реальной раскладки (та же ширина правой зоны —
 *  без скачка при подстановке данных; полоса вкладок и замоноличенный бар
 *  действий внизу — как у загруженной карточки): читается как «карточка
 *  прогружается», а не как единый тёмный прямоугольник. */
export function TaskCardSkeleton({ chatW }: { chatW: number }) {
  return (
    <div
      className="grid h-full min-h-0"
      style={{ gridTemplateColumns: `minmax(0,1fr) ${chatW}px` }}
    >
      <div className="flex min-h-0 flex-col border-r border-border">
        <div className="min-h-0 flex-1 space-y-6 overflow-hidden p-6">
          <div className="space-y-2.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-44 w-full min-w-72 max-w-[26.25rem] flex-1" />
            <Skeleton className="h-44 w-full min-w-72 max-w-[26.25rem] flex-1" />
          </div>
        </div>
        <div className="flex h-16 shrink-0 items-center gap-2 border-t border-border px-5">
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-7 w-32 rounded-md" />
        </div>
      </div>
      <div className="flex min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 bg-background p-4">
          <Skeleton className="h-14 w-3/4 self-start" />
          <Skeleton className="h-14 w-2/3 self-end" />
          <Skeleton className="h-14 w-3/4 self-start" />
          <div className="-mx-4 -mb-4 mt-auto flex h-16 shrink-0 items-center border-t border-border px-3">
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
