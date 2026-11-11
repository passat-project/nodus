import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { ChatMessage } from '@nodus/contracts';

import { isWindowAttentive } from '../attention/attention-store.js';
import { useScrollEndStore } from './scroll-end-store.js';

/**
 * Догон входящих сообщений (#132, фидбек пилотов; модель Telegram): пока
 * пользователь У НИЗА ленты — каждое чужое сообщение докручивает ленту в
 * конец тем же каналом, что и своя отправка (scroll-end-store → резидент
 * внутри провайдера примитива). Читает историю (выше низа) — сообщения
 * копятся внизу без дёрганий, счётчик непрочитанных живёт на стрелке.
 *
 * Почему app-layer, а не режим following-bottom примитива: режим живёт в
 * машине состояний node_modules-примитива, его переходы (settling-jump после
 * якоря и т.п.) ненаблюдаемы из приложения; у пилотов догона не было. Здесь
 * решение детерминировано: слушатель скролла держит «у низа» в ref, а
 * layout-effect после ДОБАВЛЕНИЯ чужого сообщения (id последнего изменился,
 * автор — не я) просит догон. Своя отправка догон просит сама (композер).
 *
 * Раунд 5 (баг «первая после F5 реакция дёргает ленту»): любая правка НИЖНЕЙ
 * части ленты (чип реакции на последнем сообщении, правка, мета) растит
 * scrollHeight, а скролл-догон примитива срабатывает только СЛЕДУЮЩИМ
 * кадром (MutationObserver/rAF) — кадр успевает отрисоваться «недокрученным»
 * → видимый рывок. Тот же layout-effect ДО отрисовки дорисовывает scrollTop
 * на прирост высоты, пока пользователь у низа: низ стоит неподвижно до
 * отрисовки, последующий scrollToEnd примитива приходит в ту же точку.
 */

/** Порог «у низа»: чуть шире 8px примитива — субпиксельные остатки скролла. */
export const NEAR_BOTTOM_PX = 32;

export function isAtBottom(viewport: HTMLElement, tolerance = NEAR_BOTTOM_PX): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= tolerance;
}

export function useIncomingFollow({
  scope,
  items,
  meId,
  viewportRef,
  enabled,
}: {
  scope: string;
  items: readonly ChatMessage[];
  meId: string | undefined;
  viewportRef: RefObject<HTMLElement | null>;
  /** Выключено, пока ленту ведёт якорь открытия (autoScroll примитива тоже
   *  выключен) — иначе догон перетянет ленту в конец при открытии. */
  enabled: boolean;
}): void {
  const atBottomRef = useRef(true);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onScroll = () => {
      atBottomRef.current = isAtBottom(viewport);
    };
    onScroll();
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [viewportRef]);

  const prevRef = useRef<{ id: string; authorId: string } | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const last = items[items.length - 1];
    if (!last) return;
    const prev = prevRef.current;
    prevRef.current = { id: last.id, authorId: last.author.id };
    if (!prev || prev.id === last.id) return;
    if (last.author.id === meId) return;
    if (!atBottomRef.current) return;
    // Фон/трей/бездействие (#770): лента не дёргается под ушедшим
    // пользователем — новые сообщения копятся внизу со стрелкой, как в
    // Telegram. Возврат внимания ничего не «прокручивает» сам.
    if (!isWindowAttentive()) return;
    useScrollEndStore.getState().request(scope, 'auto');
  }, [items, meId, scope, enabled]);

  // Pre-paint компенсация роста ленты (раунд 5): после КАЖДОГО рендера, до
  // отрисовки кадра. Высоту помним всегда (и вне enabled — фаза якоря), но
  // применяем только у низа: иначе скомпенсировали бы весь рост загрузки
  // истории при якоре. Убыль высоты (снятие чипа) не компенсируем — там
  // рывка нет: контент уезжает вниз от края, а не обнажается.
  const prevScrollHeightRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const height = viewport.scrollHeight;
    const prev = prevScrollHeightRef.current;
    prevScrollHeightRef.current = height;
    if (!enabled || prev === null || !atBottomRef.current) return;
    // В фоне компенсация = тот же догон: не удерживаем низ под ушедшим.
    if (!isWindowAttentive()) return;
    const delta = height - prev;
    if (delta > 0) viewport.scrollTop += delta;
  });
}
