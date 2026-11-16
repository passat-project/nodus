import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useElementWidth } from '../../../shared/ui/use-element-width.js';
import { uiPx } from '../../../shared/ui/ui-scale.js';
import { inputModality } from '../../../shared/lib/input-modality.js';
import {
  ASSISTANT_W_KEY,
  assistantLiveBounds,
  useAssistantStore,
} from '../model/assistant-store.js';
import { AssistantBody } from './assistant-body.js';

/** Окно ассистента — ПЛАВАЮЩИЙ ЛИСТ поверх правой части нашего окна,
 *  ВНУТРИ мягкой рамы НИЖЕ топбара (верх на оси контура, вердикт владельца
 *  16.11.2026): слева скругления 18px, вертикального hairline нет; низ и
 *  правый край в край рамы без зазоров — её скругления обрезают правые углы
 *  окна (плавный силуэт у кнопки агента); направленная тень slider-shadow
 *  (только светлая тема), тон bg-card — язык слайдеров. Шапка остаётся
 *  доступной (тема переключается во время диалога). Структуру окна НЕ
 *  двигает; ширина тянется левой границей с памятью и клампится живыми
 *  пределами рамы. Выезд справа налево — шириной СУЩЕСТВУЮЩЕЙ обёртки
 *  (закон выдвижных поверхностей: первое открытие после Ctrl+R плавное);
 *  контент монтируется после оседания выезда и остаётся (скролл/черновик целы). */
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
  const { min: minW, max: maxW } = assistantLiveBounds(frameW);
  const effWidth = Math.min(Math.max(width, minW), maxW);

  // Возврат фокуса на триггер при закрытии — только клавиатурному пользователю
  // (канон SliderPanel/input-modality): иначе focus-visible рамка на кнопке.
  const triggerRef = useRef<HTMLElement | null>(null);
  const openedViaRef = useRef<'mouse' | 'keyboard'>('mouse');
  useEffect(() => {
    if (open) {
      openedViaRef.current = inputModality();
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (openedViaRef.current === 'keyboard') {
      triggerRef.current?.focus();
    }
  }, [open]);

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
      const bounds = assistantLiveBounds(frameRef.current?.offsetWidth ?? 0);
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
        // Ниже топбара (верх на оси контура): шапка целиком доступна, в т.ч.
        // переключатель темы во время диалога (вердикт владельца 16.11.2026).
        // Элевация по темам (канон): светлая — направленная тень slider-shadow
        // БЕЗ бордюра; тёмная — теней нет, край читается hairline-бордюром по
        // периметру (ступень тона card/perimeter сливалась в шапке, вердикт
        // владельца 16.11.2026) — как у карточек-слайдеров. Цвет кромки —
        // токен --assistant-edge (transparent/бордер): dark:-утилиты в проекте
        // мертвы (вариант .dark vs data-theme), токены — канон.
        'slider-shadow absolute right-0 bottom-0 z-[60] overflow-hidden rounded-l-2xl border border-(--assistant-edge) bg-card',
        // В покое w-0 + visibility hidden: ни полосы, ни переполнения;
        // выезд — шириной существующей обёртки, без transform-скролла шелла.
        !dragging && 'transition-[width,visibility] duration-200 ease-out',
        open ? 'visible' : 'pointer-events-none invisible w-0',
      )}
      style={{ width: open ? effWidth : 0, top: uiPx(56) }}
    >
      {/* Контент фиксированной ширины: текст не плющится в кадрах анимации.
          Проявление — content-fade (ТОЛЬКО opacity): animate-in/duration-150
          включали transition: all и ширина контента догоняла обёртку с
          задержкой — «амортизация» у правого края при drag (вердикт
          владельца 16.11.2026). */}
      {ready ? (
        <div className="content-fade flex h-full flex-col" style={{ width: effWidth }}>
          <AssistantBody />
        </div>
      ) : null}
      {open ? (
        // Ручка ресайза — НЕВИДИМЫЙ оверлей w-3 целиком внутри панели
        // (канон перегородок карточек): никакой толстой цветной полосы;
        // курсор col-resize — единственная подсказка.
        <div
          onPointerDown={onDividerDown}
          title={ui.assistant.resizeHint}
          className="absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize"
        />
      ) : null}
    </div>
  );
}
