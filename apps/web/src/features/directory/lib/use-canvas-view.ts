import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { INITIAL_VIEW, panBy, wheelZoomAt, type CanvasView } from './canvas-view.js';

/** Элементы, с которых НЕ начинается панорама: клик по карточке/кнопке — их
 *  собственное действие, полотно едет только с пустого места. */
const PAN_EXCLUDE = '[data-tree-node],button,a,input,textarea,select,label';

/**
 * Снять фокус с полей ВНЕ канваса (поиск структуры в шапке): жест по полотну —
 * это работа с канвасом, а `preventDefault` ниже иначе оставляет фокус в поле и
 * оно висит «активным» с открытой выпадашкой (вердикт 17.11.2026).
 */
function blurOutside(viewport: HTMLElement): void {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return;
  if (viewport.contains(active)) return;
  active.blur();
}

/**
 * Жесты канваса структуры (#768, вердикт 13.11.2026): Ctrl/⌘+колесо — зум к
 * курсору (пинч тачпада = ctrl+wheel), колесо без Ctrl — панорама, зажатая ЛКМ
 * по пустому месту — перетаскивание полотна. Слушатель колеса вешается
 * НЕпассивно (в React-пропе preventDefault не работает — gotcha фронтенда),
 * панорама — pointer capture на вьюпорте.
 */
export function useCanvasView(viewportRef: RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState<CanvasView>(INITIAL_VIEW);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    view: CanvasView;
  } | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      const rect = node.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      event.preventDefault();
      // Колесо по полотну — тоже работа с канвасом: поле поиска в шапке
      // перестаёт быть «активным» (вердикт 17.11.2026).
      blurOutside(node);
      if (event.ctrlKey || event.metaKey) {
        setView((current) => wheelZoomAt(current, event.deltaY, point));
        return;
      }
      setView((current) => panBy(current, -event.deltaX, -event.deltaY));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [viewportRef]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // События из порталов Radix (меню «⋯» карточки, диалоги, поповеры) React
    // всплывает по ДЕРЕВУ КОМПОНЕНТОВ — они приходят сюда, хотя в DOM живут в
    // body. Без этой проверки pointerdown на пункте меню начинал панораму и
    // забирал pointer capture: пункт не получал click, полотно ехало (#768).
    if (target && !event.currentTarget.contains(target)) return;
    if (target?.closest(PAN_EXCLUDE)) return;
    // Работа с полотном снимает фокус с полей шапки (поиск структуры): ниже
    // preventDefault оставляет фокус там, где он был, и поле висело «активным»
    // после клика/панорамы по канвасу (вердикт 17.11.2026).
    blurOutside(event.currentTarget);
    // Панорама не должна выделять текст карточек, через которые тянем полотно.
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      view: viewRef.current,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPanning(true);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    setView(panBy(state.view, event.clientX - state.startX, event.clientY - state.startY));
  }, []);

  const endPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, []);

  return {
    view,
    setView,
    panning,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPan,
      onPointerCancel: endPan,
    },
  };
}
