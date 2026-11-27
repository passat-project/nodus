import { createContext, useContext } from 'react';

/**
 * Панель карточки раскрыта — анимация scale завершена (SliderPanel).
 *
 * Зачем: раскрытие карточки стека — CSS-анимация scale (FLIP), а React Flow
 * меряет ручки через `getBoundingClientRect` (`getHandleBounds` в
 * @xyflow/system: смещение ручки = (rect ручки − rect ноды) / zoom движка).
 * Пока предок в масштабе анимации, rect'ы умножены на него, а делится только
 * на zoom — ручки получают координаты ~0, и стрелки идут по верхнему краю нод
 * (наблюдение владельца 27.11: «в карточке поверх из типа проекта связи
 * кривые, потом выравниваются»). Поэтому холсты монтируются, только когда
 * панель раскрылась: первый же кадр схемы измерен правильно, без «прыжка»
 * стрелок. Вне панели (рабочая область, окна) значение — сразу `true`.
 */
export const PanelExpandedContext = createContext(true);

export function usePanelExpanded(): boolean {
  return useContext(PanelExpandedContext);
}
