import { Skeleton } from '@nodus/ui/components/skeleton';

/** Скелетон карточки сотрудника зеркалит анатомию #750: слева — постоянная
 *  зона профиля (фото + поля), справа — полоса вкладок и колонка чата
 *  (ширина — живая, из useChatWidth: полоса не прыгает при подмене). */
export function EmployeeCardSkeleton({ chatW }: { chatW: number }) {
  return (
    <div className="flex h-full min-w-0">
      <div
        className="grid min-h-0 min-w-0 flex-1"
        style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
      >
        <div className="flex min-h-0 flex-col border-r border-border">
          <div className="flex min-h-0 flex-1 items-start gap-8 p-6">
            <Skeleton className="size-44 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-4">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-4 w-2/3" />
              ))}
            </div>
          </div>
        </div>
        <div className="min-h-0 overflow-hidden" style={{ width: chatW }}>
          <div className="flex h-full flex-col">
            <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-16" />
            </div>
            <div className="flex flex-col gap-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-2/3" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
