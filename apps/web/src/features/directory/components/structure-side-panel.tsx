import { cn } from '@nodus/ui/lib/utils';

/**
 * Правая панель раздела «Сотрудники» (#768): одна на всех — подразделение
 * ИЛИ должности. Постоянная, как в Битриксе (вердикты 13.11.2026): панель не
 * выезжает и не скрывается — канвас и шапка никогда не сдвигаются, «Должности»
 * лишь подменяют содержимое. Стоит ВПЛОТНУЮ к правому и нижнему краю канваса
 * (без зазоров, скругление только слева); верх — на горизонтали оси контура
 * (topShift). Шапка панели — общая строка h-14 без верхнего паддинга
 * (`StructurePanelHeader`): её центр — на одной горизонтали с шапкой страницы
 * (вердикт 16.11.2026).
 */
export function StructureSidePanel({
  topShift,
  header,
  children,
  className,
}: {
  topShift: number;
  /** Строка `StructurePanelHeader` (h-14) — выравнивается с шапкой страницы. */
  header: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-structure-side-panel
      style={{ top: topShift }}
      className={cn('absolute right-0 bottom-0 z-10 w-80 overflow-hidden', className)}
    >
      <div className="flex h-full w-full flex-col overflow-hidden rounded-l-[14px] border border-r-0 border-b-0 border-border bg-card">
        <div className="shrink-0 px-4">{header}</div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4">
          {children}
        </div>
      </div>
    </div>
  );
}
