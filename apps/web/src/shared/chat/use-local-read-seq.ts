import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ChatMessage } from '@nodus/contracts';

import { isUserActive } from '../attention/attention-store.js';
import { useModalLayerCovered } from '../attention/modal-layers.js';
import { useSurfaceVisible } from '../lib/surface-visibility.js';
import { isAtBottom } from './use-incoming-follow.js';

/**
 * Локальный водяной знак прочтения ленты — источник границы плашки
 * «Непрочитанные сообщения» (#845, Telegram-модель).
 *
 * Серверный `myLastReadSeq` приходит из списка бесед с задержкой: квитанция
 * просмотра уходит троттлом 500 мс, список инвалидируется медленным ярусом.
 * До этого снимок списка возвращал старый знак — плашка на мгновение
 * воскресала над уже прочитанными сообщениями, вставка строки толкала ленту,
 * удаление — возвращала её обратно (жалоба владельца). Лента сама знает, что
 * уже видела, и не обязана ждать сеть.
 *
 * Знак двигают два источника, оба — только при реальном внимании (гейты те
 * же, что у квитанций #770/#809: окно в фокусе + ввод за 30 с + поверхность
 * на виду + нет модального слоя):
 *  1) ДОБАВЛЕНИЕ сообщений, когда пользователь у низа, — синхронно до
 *     отрисовки. Это та самая семантика открытого чата: новое сообщение,
 *     появившееся на глазах, уже прочитано (в Telegram Desktop для этого у
 *     `UnreadBar` есть флаг `freezed`).
 *  2) Геометрия видимости — `markSeen` зовёт наблюдатель ленты
 *     (`useFeedViewportRead`): низ строки в вьюпорте, значит просмотрено.
 *
 * Знак двигается ТОЛЬКО вперёд и не зависит от рефечей: отставший серверный
 * снимок не может его откатить.
 */
export function useLocalReadSeq({
  items,
  viewportRef,
  enabled,
}: {
  items: readonly ChatMessage[];
  viewportRef: RefObject<HTMLElement | null>;
  /** Выключено, пока ленту ведёт якорь открытия: смена `items` в этот момент —
   *  загрузка истории, а не новое сообщение на глазах, и решает якорь. */
  enabled: boolean;
}): { localReadSeq: number | null; markSeen: (seq: number | null) => void } {
  const [localReadSeq, setLocalReadSeq] = useState<number | null>(null);
  const markSeen = useCallback((seq: number | null) => {
    if (seq === null || seq <= 0) return;
    setLocalReadSeq((prev) => (prev === null || seq > prev ? seq : prev));
  }, []);

  // «У низа» до вставки сообщения: ref обновляется скроллом, поэтому в
  // layout-эффекте после рендера он ещё несёт позицию ДО роста контента —
  // ровно то, что нужно решению «новое появилось на глазах».
  const atBottomRef = useRef(true);
  // Первичный замер — до отрисовки: примитив уже применил позицию открытия
  // (детские layout-эффекты раньше родительских), дефолт true не должен
  // прочитать историю открытого посередине чата.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) atBottomRef.current = isAtBottom(viewport);
  }, [viewportRef]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onScroll = (): void => {
      atBottomRef.current = isAtBottom(viewport);
    };
    onScroll();
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [viewportRef]);

  const surfaceVisible = useSurfaceVisible();
  const covered = useModalLayerCovered();

  // Последнее НЕтемповое сообщение (seq > 0): темп оптимистичной отправки
  // живёт с seq = 0 и не должен ни считаться, ни сбивать «добавление».
  const prevLastIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    let last: { id: string; seq: number } | null = null;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i]!;
      if (item.seq > 0) {
        last = item;
        break;
      }
    }
    const prevId = prevLastIdRef.current;
    prevLastIdRef.current = last?.id ?? null;
    if (!enabled || last === null || prevId === last.id) return;
    // Те же гейты, что у квитанций: знак не бежит впереди того, что сервер
    // вправе записать прочитанным.
    if (!isUserActive() || !surfaceVisible || covered) return;
    if (!atBottomRef.current) return;
    markSeen(last.seq);
  }, [items, enabled, surfaceVisible, covered, markSeen]);

  return { localReadSeq, markSeen };
}
