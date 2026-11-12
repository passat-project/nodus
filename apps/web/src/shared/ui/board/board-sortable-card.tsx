import { useEffect, useState, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '@nodus/ui/lib/utils';

/** Карточка смонтирована хотя бы один кадр (официальный useMountStatus):
 * перемонтированная в чужую колонку ВО ВРЕМЯ drag карточка не должна стартовать
 * транзишен с неверных координат — первый кадр без transition. */
function useMountStatus(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return mounted;
}

/**
 * Sortable-обёртка карточки борда (ADR-0007, общая оболочка канбана):
 * useSortable даёт dnd-состояние карточки и клавиатурные атрибуты, призрак
 * рисует DragOverlay потребителя. Трансформы sortable НЕ применяются
 * (`liveBoardSortingStrategy` — null): порядок борда переставляется ЖИВОЙ на
 * каждом движении, поэтому слот переносимой карточки — её DOM-узел на новом
 * месте, а соседи разъезжаются сменой DOM-порядка. Штатная
 * verticalListSortingStrategy в этом режиме разворачивает сторону вставки
 * (механизм — `shared/lib/board/board-sorting.ts`, gotcha #737).
 * Контент карточки — render-проп (placeholder — слот переносимой карточки,
 * пунктир).
 * Сенсоры на активаторе: клик без движения — открытие слайдера
 * (distance-констрейнт PointerSensor задаёт потребитель борда).
 * БЕЗ memo (аудит #45): render-проп — новая стрелка на каждый рендер борда,
 * shallow-compare всегда false — мёртвый memo («мемо ради мемо»); оживление
 * = стабильные пропы вместо render-пропа, а во время drag карточку всё равно
 * перерисовывает контекст useSortable — выгоды нет, честнее без обёртки.
 * Колонку движок доски выводит из своего борда по оси (stageOfDragId), а не
 * из `data` sortable — ось у досок разная, данные карточки её не знают.
 */
export function BoardSortableCard({
  id,
  disabled = false,
  children,
}: {
  id: string;
  /** Отключить drag (активный фильтр списка: перестановка по урезанному
   *  набору давала бы ложные индексы — фильтрация только сужает обзор). */
  disabled?: boolean;
  children: (state: { placeholder: boolean }) => ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  const mounted = useMountStatus();
  const mountedWhileDragging = isDragging && !mounted;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: mountedWhileDragging ? undefined : transition,
      }}
    >
      <div
        ref={setActivatorNodeRef}
        className={cn(disabled ? 'cursor-default' : 'cursor-grab', isDragging && 'opacity-40')}
        {...(disabled ? {} : listeners)}
        {...(disabled ? {} : attributes)}
      >
        {children({ placeholder: isDragging })}
      </div>
    </div>
  );
}
