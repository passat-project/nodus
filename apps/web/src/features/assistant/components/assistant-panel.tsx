import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useElementWidth } from '../../../shared/ui/use-element-width.js';
import { uiPx } from '../../../shared/ui/ui-scale.js';
import {
  ASSISTANT_W_KEY,
  ASSISTANT_W_MAX,
  ASSISTANT_W_MIN,
  useAssistantStore,
} from '../model/assistant-store.js';
import { AssistantBody } from './assistant-body.js';

/** Живой потолок ширины: не больше 45% рамы (на узком окне панель не съедает
 *  больше половины working-зоны) и не уже читаемого минимума. */
function liveBounds(frameW: number): { min: number; max: number } {
  const max = Math.min(ASSISTANT_W_MAX, Math.max(uiPx(240), Math.floor(frameW * 0.45)));
  return { min: Math.min(ASSISTANT_W_MIN, max), max };
}

/** Окно ассистента — ПЛАВАЮЩИЙ ЛИСТ поверх правой части нашего окна,
 *  ВНУТРИ мягкой рамы во ВСЮ её высоту, до самого верха (вердикт владельца
 *  16.11.2026: ровный обрез на оси отвергнут): слева скругления 18px сверху
 *  и снизу + hairline-бордюр; правый край в край рамы без зазоров — её
 *  скругления обрезают правые углы окна (плавный силуэт у кнопки агента);
 *  направленная тень slider-shadow (только светлая тема), тон bg-card —
 *  язык слайдеров. Структуру окна НЕ двигает: накрывает контент справа
 *  (включая правую группу топбара); ширина тянется левой границей с памятью
 *  и клампится живыми пределами рамы. Выезд справа налево — шириной
 *  СУЩЕСТВУЮЩЕЙ обёртки
 *  (закон выдвижных поверхностей: первое открытие после Ctrl+R плавное);
 *  контент лениво на первом открытии и остаётся (скролл/черновик целы). */
export function AssistantPanel() {
  const open = useAssistantStore((s) => s.open);
  const width = useAssistantStore((s) => s.width);
  const dragging = useAssistantStore((s) => s.dragging);
  // Контент монтируется ПОСЛЕ оседания выезда (канон слайдеров: тяжёлое
  // дерево не платит в кадрах width-анимации): лист выезжает пустым,
  // контент проявляется fade-in; дальше остаётся (скролл/черновик целы).
  const [ready, setReady] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLElement | null>(null);

  // Рама — позиционированный предок (relative в шелле): якорь и обрезка.
  useLayoutEffect(() => {
    frameRef.current = paneRef.current?.parentElement ?? null;
  });
  const frameW = useElementWidth(frameRef);
  const { min: minW, max: maxW } = liveBounds(frameW);
  const effWidth = Math.min(Math.max(width, minW), maxW);

  useEffect(() => {
    if (!open) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReady(true);
      return;
    }
    const t = window.setTimeout(() => setReady(true), 210);
    return () => window.clearTimeout(t);
  }, [open]);

  // Esc гасит окно ассистента РАНЬШЕ карточек стека (окно поверх них):
  // preventDefault отфильтровывает слушатель SliderPanel; открытый поповер
  // пикера сессий Esc закрывает сам (Radix) — окно не трогаем.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      event.preventDefault();
      useAssistantStore.getState().setOpen(false);
    };
    // CAPTURE: раньше bubble-слушателей SliderPanel (карточка смонтирована
    // раньше и иначе закрывалась бы вместе с окном).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  function onDividerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const store = useAssistantStore.getState();
    const startX = event.clientX;
    const startW = store.width;
    let latest = startW;
    let raf = 0;
    store.setDragging(true);
    const onMove = (ev: globalThis.PointerEvent) => {
      const bounds = liveBounds(frameRef.current?.offsetWidth ?? 0);
      latest = Math.min(Math.max(startW + (startX - ev.clientX), bounds.min), bounds.max);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        useAssistantStore.getState().setWidth(latest);
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (raf) cancelAnimationFrame(raf);
      const s = useAssistantStore.getState();
      s.setDragging(false);
      s.setWidth(latest);
      localStorage.setItem(ASSISTANT_W_KEY, String(latest));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  return (
    <div
      ref={paneRef}
      role="complementary"
      aria-label={ui.assistant.title}
      aria-hidden={!open || undefined}
      className={cn(
        // Во ВСЮ высоту мягкой рамы, до самого верха (вердикт владельца
        // 16.11.2026: ровный обрез на оси отвергнут): слева свои скругления
        // 18px сверху и снизу + hairline-бордюр; правый край в край рамы —
        // её скругления обрезают правые углы окна (плавный силуэт у кнопки
        // агента). Без зазоров. Рама relative — якорь и обрезка.
        // Скругления слева 18px сверху и снизу (вердикт владельца: закругление
        // НЕ убирать); вертикального hairline НЕТ вовсе (вердикт 16.11.2026):
        // край читается тенью slider-shadow в светлой теме и ступенью тона
        // зоны в тёмной.
        // z-[60]: ПОВЕРХ всех карточек-слайдеров (z-50) — окно ассистента не
        // перекрывается задачей/проектом (вердикт владельца 16.11.2026);
        // контур (z-60, позже в DOM) и оверлей-порталы/тосты (z-70) выше.
        'slider-shadow absolute inset-y-0 right-0 z-[60] overflow-hidden rounded-l-2xl bg-card',
        // В покое w-0 + visibility hidden: ни полосы, ни переполнения;
        // выезд — шириной существующей обёртки, без transform-скролла шелла.
        !dragging && 'transition-[width,visibility] duration-200 ease-out',
        open ? 'visible' : 'pointer-events-none invisible w-0',
      )}
      style={{ width: open ? effWidth : 0 }}
    >
      {/* Контент фиксированной ширины: текст не плющится в кадрах анимации. */}
      {ready ? (
        <div
          className="animate-in fade-in flex h-full flex-col duration-150"
          style={{ width: effWidth }}
        >
          <AssistantBody />
        </div>
      ) : null}
      {open ? (
        // Ручка ресайза — НЕВИДИМЫЙ оверлей w-3 поверх границы (канон
        // перегородок карточек): никакой толстой цветной полосы; курсор
        // col-resize — единственная подсказка.
        <div
          onPointerDown={onDividerDown}
          title={ui.assistant.resizeHint}
          className="absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize"
        />
      ) : null}
    </div>
  );
}
