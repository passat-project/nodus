import { useLayoutEffect, useRef } from 'react';
import {
  getViewportForBounds,
  useReactFlow,
  useStore,
  useStoreApi,
  type Node,
} from '@xyflow/react';

import { CANVAS_MIN_ZOOM, FIT, measuredBounds, workingViewport } from './working-viewport.js';

export interface FlowAutoFitProps {
  /** Ключ графа: вписать один раз на каждое его новое значение. */
  fitKey: string;
  /** Текущий граф — сверяется со стором движка перед вписыванием. */
  graph: Node[];
  /** Длительность перехода вида, мс; 0 — сразу. */
  duration: number;
}

/**
 * Вписывание вида холста — ОДИН раз, когда узлы графа измерены, и заново
 * только при смене графа (`fitKey`) — по правилу рабочего масштаба
 * (`working-viewport.ts`): граф, который в рабочий масштаб не влезает
 * по какой-то оси, по этой оси стоит началом, а не мельчает до
 * нечитаемых подписей.
 * Смена размера холста (выезд правой панели, окно) вид НЕ трогает: граф стоит,
 * край холста его просто обрезает (вердикт владельца 20.10 — «чтобы не
 * дёргалось ничего лишний раз»). Добавление статуса вид тоже не дёргает. Весь
 * граф целиком — кнопка «Вписать» на панели холста.
 *
 * Вписываем сами и синхронно — в layout-эффекте того коммита, в котором граф
 * оказался в сторе движка измеренным: первый кадр с новыми узлами уже на
 * месте. `fitView()` движка идёт через очередь и кадр: при смене типа в
 * колонке успевал вписать ПРЕДЫДУЩИЙ граф (#857, Д1), а при первом
 * монтировании давал кадр «граф крупным» (#857, К4). Границы берём из стора и
 * сверяем с текущим графом (`measuredBounds`): чужие или ещё не измеренные
 * узлы — не вписываем, ждём следующего коммита.
 *
 * Размер холста берём из самого элемента, а не из стора: стор узнаёт о смене
 * размера своей ResizeObserver позже измерения узлов (рамы задачи и письма
 * разной высоты — холст 714 и 711), и впис по прежней высоте уводил граф на
 * полразницы от центра.
 */
export function FlowAutoFit({ fitKey, graph, duration }: FlowAutoFitProps) {
  const store = useStoreApi();
  const sized = useStore((s) => s.width > 0 && s.height > 0);
  // Движок готов к виду (панорама/масштаб созданы) и узлы в его сторе измерены.
  const ready = useStore((s) => s.panZoom !== null && s.nodesInitialized);
  // Узлы в сторе сменяются после коммита (свойство `nodes` уходит туда
  // эффектом) — их смена и есть сигнал «можно сверять граф со стором».
  const storeNodes = useStore((s) => s.nodes);
  const { setViewport } = useReactFlow();
  const fitted = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!sized || !ready || fitted.current === fitKey) return;
    const state = store.getState();
    const width = state.domNode?.offsetWidth || state.width;
    const height = state.domNode?.offsetHeight || state.height;
    const bounds = measuredBounds(graph, state.nodeLookup);
    if (!bounds) return;
    fitted.current = fitKey;
    void setViewport(
      workingViewport(
        getViewportForBounds(bounds, width, height, CANVAS_MIN_ZOOM, FIT.maxZoom, FIT.padding),
        bounds,
        width,
        height,
      ),
      duration ? { duration } : undefined,
    );
  }, [fitKey, graph, sized, ready, storeNodes, setViewport, store, duration]);
  return null;
}
