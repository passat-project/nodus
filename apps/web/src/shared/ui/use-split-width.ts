import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

/**
 * Перегородка «данные | панель» в карточке сущности с памятью ширины —
 * закон выдвижных поверхностей: где есть разделитель, он ТЯНЕТСЯ и помнит
 * ширину (модель сплита IDE, как `useChatWidth` у колонки чата).
 *
 * Дефолт — ДОЛЯ контейнера (50%: у справочника мало полей, основную ширину
 * забирает зона вкладок — вердикт владельца 25.10.2026), память — в px:
 * после первого перетаскивания колонка держит выбранный размер. Drag —
 * ИМПЕРАТИВНО (`el.style.width` напрямую, без setState на кадр), React-state
 * и localStorage — один раз на pointerup.
 *
 * @param panelRef — колонка, чью ширину двигаем (левая зона карточки);
 * @param storeKey — ключ памяти (у каждой карточки своя перегородка);
 * @param defaultRatio — доля контейнера по умолчанию;
 * @param min — минимум колонки, `minOther` — минимум второй зоны.
 */
export function useSplitWidth(
  panelRef: RefObject<HTMLDivElement | null>,
  {
    storeKey,
    defaultRatio = 0.5,
    min,
    minOther,
  }: { storeKey: string; defaultRatio?: number; min: number; minOther: number },
) {
  const [width, setWidth] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem(storeKey));
    return Number.isFinite(stored) && stored >= min ? stored : null;
  });
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const containerW = useCallback(
    () => panelRef.current?.parentElement?.getBoundingClientRect().width ?? 0,
    [panelRef],
  );
  const clamp = useCallback(
    (value: number, total: number) =>
      Math.max(min, Math.min(value, Math.max(min, total - minOther))),
    [min, minOther],
  );

  // Окно сузили — сохранённая ширина не должна выдавить вторую зону.
  useEffect(() => {
    if (width === null) return;
    const onResize = () => {
      const total = containerW();
      const next = total ? clamp(width, total) : width;
      if (next !== width) {
        setWidth(next);
        localStorage.setItem(storeKey, String(next));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [width, clamp, storeKey, containerW]);

  const onDividerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const total = containerW();
      const startX = event.clientX;
      const startW = widthRef.current ?? Math.round(total * defaultRatio);
      let latest = startW;
      let raf = 0;
      setDragging(true);
      const onMove = (ev: globalThis.PointerEvent) => {
        latest = clamp(startW + (ev.clientX - startX), total);
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const el = panelRef.current;
          if (el) el.style.width = `${latest}px`;
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (raf) cancelAnimationFrame(raf);
        setDragging(false);
        setWidth(latest);
        localStorage.setItem(storeKey, String(latest));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      // pointercancel (touch/pen, перехват жеста) завершает drag как pointerup:
      // без него состояние «тянется» навсегда — перегородка липнет к курсору.
      window.addEventListener('pointercancel', onUp);
    },
    [panelRef, clamp, defaultRatio, containerW, storeKey],
  );

  return {
    /** Ширина колонки в px; null — дефолтная доля контейнера. */
    width,
    style: width === null ? { width: `${defaultRatio * 100}%` } : { width },
    onDividerDown,
    dragging,
  };
}
