/**
 * Индекс вставки карточки канбана — по позиции УКАЗАТЕЛЯ (#737).
 *
 * Прежний расчёт жил в onDragOver и срабатывал только при входе в колонку, а
 * сторону «над/под» решал по верху перетаскиваемой карточки: карточку вели
 * снизу под целевую — её верх ещё был выше середины цели → фантом рисовался
 * над; вели сверху — наоборот. Внутриколоночные движения (activeStage ===
 * overStage) вообще выходили из обработчика ранним return, поэтому после
 * первого кадра фантом «залипал», а в колонке из одной карточки выбора
 * «над/под» не было.
 *
 * Теперь сторона считается на КАЖДОМ движении: вертикаль указателя (мышь,
 * перо, палец) либо, для drag с клавиатуры, центр проекции карточки —
 * относительно середины целевой карточки. Индекс — среди ОСТАЛЬНЫХ карточек
 * колонки (сематика серверного `index`: активная карточка вынута, остальные
 * сдвигаются), поэтому 1 карточка даёт позиции 0/1, две — 0/1/2 («между»
 * доступно), N — любую из N+1.
 */

/** Вертикаль, по которой решается сторона вставки. */
export interface DropAnchorArgs {
  /** Событие активации drag (PointerEvent/MouseEvent/TouchEvent — есть
   *  clientY; KeyboardEvent — нет: drag с клавиатуры). */
  activatorEvent: unknown;
  /** Суммарная дельта drag по Y (dnd-kit `delta.y`). */
  deltaY: number;
  /** Проекция активной карточки (translated rect) — путь клавиатуры. */
  activeProjected: { top: number; height: number } | null;
}

/** clientY события активации: указатель (мышь/перо) или первый палец.
 *  null — событие без координат (клавиатура) или не событие вовсе. */
export function activatorPointerY(event: unknown): number | null {
  if (!event || typeof event !== 'object') return null;
  const candidate = event as {
    clientY?: unknown;
    touches?: ArrayLike<{ clientY?: unknown }>;
    changedTouches?: ArrayLike<{ clientY?: unknown }>;
  };
  if (typeof candidate.clientY === 'number' && Number.isFinite(candidate.clientY)) {
    return candidate.clientY;
  }
  const touch = candidate.touches?.[0] ?? candidate.changedTouches?.[0];
  return typeof touch?.clientY === 'number' && Number.isFinite(touch.clientY)
    ? touch.clientY
    : null;
}

/** Вертикаль якоря вставки: указатель при drag мышью/пальцем, центр проекции
 *  карточки при drag с клавиатуры. null — геометрии нет (не двигаем борд). */
export function dropAnchorY({
  activatorEvent,
  deltaY,
  activeProjected,
}: DropAnchorArgs): number | null {
  const start = activatorPointerY(activatorEvent);
  if (start !== null) return start + (Number.isFinite(deltaY) ? deltaY : 0);
  if (activeProjected) return activeProjected.top + activeProjected.height / 2;
  return null;
}

export interface InsertIndexArgs {
  /** Вертикаль указателя/проекции (dropAnchorY). */
  anchorY: number | null;
  /** Индекс целевой карточки в колонке ВМЕСТЕ с активной; -1 — over это сама
   *  колонка (пустая колонка / фон). */
  overIndex: number;
  /** Индекс активной карточки в этой же колонке; -1 — активная в другой. */
  activeIndex: number;
  /** Сколько карточек останется в колонке после вынимания активной. */
  restCount: number;
  /** Measured rect целевой карточки. */
  overTop: number;
  overHeight: number;
}

/** Индекс вставки среди ОСТАЛЬНЫХ карточек колонки (-1 — обновлять нечего). */
export function computeInsertIndex({
  anchorY,
  overIndex,
  activeIndex,
  restCount,
  overTop,
  overHeight,
}: InsertIndexArgs): number {
  // over — колонка: карточка встаёт в конец (пустая — позиция 0).
  if (overIndex < 0) return Math.max(0, restCount);
  // over — сама активная: коллизия её исключает, но страхуемся от цикла.
  if (anchorY === null || overIndex === activeIndex) return -1;
  const below = anchorY > overTop + overHeight / 2;
  // Индекс цели среди остальных: активная перед ней занимает место в списке.
  const restIndex = overIndex - (activeIndex >= 0 && activeIndex < overIndex ? 1 : 0);
  return restIndex + (below ? 1 : 0);
}
