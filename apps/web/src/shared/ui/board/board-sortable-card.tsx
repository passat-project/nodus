import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';

import { cn } from '@nodus/ui/lib/utils';

import { layoutPosition, flipDelta } from '../../lib/board/board-flip.js';

/** Тайминги совпадают с прежней анимацией dnd-kit (200 мс, ease-out):
 *  владелец к движению привык — менять ощущение незачем. */
const FLIP_TIMING: KeyframeAnimationOptions = {
  duration: 200,
  easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
};

/** Текущий визуальный сдвиг карточки (mid-flight анимации). Нужен, чтобы
 *  пере-целивание FLIP не «щёлкало» в момент, когда предыдущая анимация ещё
 *  не доехала: стартовый кадр = текущий сдвиг + сдвиг новой раскладки. */
function currentTranslate(node: HTMLElement): { x: number; y: number } {
  if (typeof DOMMatrixReadOnly === 'undefined') return { x: 0, y: 0 };
  const value = getComputedStyle(node).transform;
  if (!value || value === 'none') return { x: 0, y: 0 };
  const matrix = new DOMMatrixReadOnly(value);
  return { x: matrix.m41, y: matrix.m42 };
}

/**
 * Sortable-обёртка карточки борда (ADR-0007, общая оболочка канбана):
 * `useSortable` даёт dnd-состояние карточки и клавиатурные атрибуты, призрак
 * рисует DragOverlay потребителя. Трансформы sortable НЕ применяются (стратегия
 * борда нейтральная — `liveBoardSortingStrategy`, механизм в
 * `lib/board/board-sorting.ts`): порядок переставляется ЖИВОЙ, а движение
 * карточек даёт FLIP — фактический сдвиг «старое место → новое» (200 мс,
 * `lib/board/board-flip.ts`). FLIP только показывает уже принятую перестановку
 * и не участвует в выборе стороны вставки — инверсия слота невозможна.
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
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } = useSortable({
    id,
    disabled,
  });
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const prevPosition = useRef<ReturnType<typeof layoutPosition>>(null);
  const animation = useRef<Animation | null>(null);

  // Стабильный колбэк: setNodeRef dnd-kit не должен пере-монтировать ref
  // на каждый рендер — иначе потеряется «позиция до» и анимация не сыграет.
  const setMergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      nodeRef.current = node;
      if (node === null) animation.current?.cancel();
    },
    [setNodeRef],
  );

  // FLIP: сравнение layout-позиции с прошлым коммитом. Позиция НЕ включает
  // CSS-трансформы (offsetTop/offsetLeft), поэтому бегущая анимация не попадает
  // в «позицию до» и не перезапускает сама себя: карточки перерисовываются на
  // каждое движение указателя, а новый порядок — только когда он реально новый.
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node || typeof node.animate !== 'function') return;
    const next = layoutPosition(node);
    const prev = prevPosition.current;
    prevPosition.current = next;
    const delta = prev && next ? flipDelta(prev, next) : null;
    if (!delta) return;
    // Стартовый кадр — от текущего визуального положения, а не от прошлой
    // раскладки: иначе быстрое пере-целивание «щёлкает» в середине анимации.
    const running = currentTranslate(node);
    animation.current?.cancel();
    animation.current = node.animate(
      [
        { transform: `translate(${running.x + delta.dx}px, ${running.y + delta.dy}px)` },
        { transform: 'translate(0px, 0px)' },
      ],
      FLIP_TIMING,
    );
  });

  return (
    <div ref={setMergedRef}>
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
