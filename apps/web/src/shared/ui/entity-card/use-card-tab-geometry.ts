import { useCallback, type RefObject } from 'react';

import type { CardTabGroup, CardTabAreaRect, RectLike } from './card-tabs-model.js';

export const rectOf = (el: Element): RectLike => {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
};

/**
 * Замер живых областей вкладок для DnD (#746): полосы, контент, вкладки.
 * Считается на кадр перетаскивания, не на каждый рендер; scroll учтён
 * через getBoundingClientRect вкладок внутри прокручиваемой полосы.
 */
export function useCardTabGeometry({
  rootRef,
  groups,
  stripEls,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  groups: CardTabGroup[];
  stripEls: RefObject<Map<string, HTMLDivElement>>;
}) {
  return useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      const zero = { left: 0, top: 0, right: 0, bottom: 0 };
      return { areas: [] as CardTabAreaRect[], workArea: zero, strips: [] };
    }
    const workArea = rectOf(root);
    const areas = groups.flatMap((group) => {
      const strip = stripEls.current?.get(group.id);
      if (!strip) return [];
      const stripRect = rectOf(strip);
      return [
        {
          groupId: group.id,
          strip: stripRect,
          content: {
            left: stripRect.left,
            top: stripRect.bottom,
            right: stripRect.right,
            bottom: workArea.bottom,
          },
          tabs: Array.from(strip.querySelectorAll<HTMLElement>('[data-card-tab-id]')).map((el) => ({
            tabId: el.dataset.cardTabId!,
            rect: rectOf(el),
          })),
        },
      ];
    });
    const strips = groups.flatMap((group) => {
      const el = stripEls.current?.get(group.id);
      return el ? [{ el, rect: rectOf(el) }] : [];
    });
    return { areas, workArea, strips };
  }, [groups, rootRef, stripEls]);
}
