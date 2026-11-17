import { useLayoutEffect, useRef, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';

import { parseCardStack } from './card-stack.js';
import { CIRCUIT_REMEASURE } from './circuit-geometry.js';
import { useShellStore } from './shell-store.js';

/** Отсрочка замера в режиме карточки — та же, что у контура (CARD_SETTLE_MS):
 *  FLIP-раскрытие трансформирует хедер, rect переходный. */
const CARD_SETTLE_MS = 480;

/**
 * Живая ось контура (верхняя граница окон на оси): в шелле — низ топбара,
 * под фулскрин-карточкой мессенджера — низ её хедера (`data-card-topbar`).
 * Потребитель — окно ассистента: его верх стоит НА оси, чтобы нижняя линия
 * шапки совпадала с разделителем карточки мессенджера, а линия графа легла
 * поверх верхнего бордюра (замечание владельца 17.11.2026).
 *
 * Возвращает viewport-Y оси или null, пока каркас не смонтирован. Слушатели —
 * те же события, что перемеряют контур: resize и CIRCUIT_REMEASURE (смена
 * вкладок карточки); смена вершины стека/фазы закрытия перезапускает эффект.
 * Вход в режим карточки — замер после оседания FLIP (как контур), выход —
 * сразу; пока карточка раскрывается, ось держится на шелле.
 */
export function useCircuitAxisY(): number | null {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const cardClosing = useShellStore((s) => s.cardClosing);
  const topKind = parseCardStack(new URLSearchParams(searchStr).get('cards')).at(-1)?.kind;
  const cardMode = topKind === 'messenger' && !cardClosing;
  const [axisY, setAxisY] = useState<number | null>(null);
  const prevCardMode = useRef(cardMode);
  const settling = useRef(false);

  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector<HTMLElement>(
        cardMode ? '[data-card-topbar]' : '[data-topbar]',
      );
      setAxisY(el ? el.getBoundingClientRect().bottom : null);
    };
    let settle = 0;
    // Вход в режим карточки — rect хедера в FLIP-трансформе: ждём оседания.
    // Уже открытая карточка (окно ассистента открыли позже) — замер сразу.
    if (cardMode && !prevCardMode.current) {
      settling.current = true;
      settle = window.setTimeout(() => {
        settling.current = false;
        measure();
      }, CARD_SETTLE_MS);
    } else {
      measure();
    }
    prevCardMode.current = cardMode;
    const onRemeasure = () => {
      if (!settling.current) measure();
    };
    const ro = new ResizeObserver(onRemeasure);
    ro.observe(document.documentElement);
    window.addEventListener(CIRCUIT_REMEASURE, onRemeasure);
    return () => {
      window.clearTimeout(settle);
      settling.current = false;
      ro.disconnect();
      window.removeEventListener(CIRCUIT_REMEASURE, onRemeasure);
    };
  }, [cardMode]);

  return axisY;
}
