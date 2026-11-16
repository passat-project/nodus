import { Bot } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { useRailHidden } from '../../../app/shell/rail-visibility.js';
import { useAssistantStore } from '../model/assistant-store.js';

/** Вход в ассистента там, где полоса аватарок скрыта (мессенджер): у правого
 *  края экрана при ПОДВОДЕ КУРСОРА всплывает кнопка-робот и ПЛАВНО ведёт за
 *  курсором по высоте (вердикт владельца 16.11.2026: погоня нравится, но
 *  должна быть красивой): позиция — императивно в rAF с демпфированием
 *  (канон императивных drag: React не рендерит на каждый кадр), появление —
 *  только opacity (zoom-анимация конфликтовала бы с transform позиции).
 *  Hover-намеренность ~250 мс, уход гасит с grace ~150 мс. Погоня НЕ
 *  замирает под курсором: заморозка давала осцилляцию «догнал-встал-догнал»
 *  (вердикт владельца 16.11.2026: дёргается); плавный догон с демпфированием
 *  кликабелен и на ходу. Появление/гашение — ТОЛЬКО opacity: enter-keyframes
 *  animate-in бьют по transform и сбрасывали императивную позицию в ноль.
 *  Клик открывает окно; Ctrl+J работает всегда. Слежение — pointermove окна,
 *  НЕ перехватчик кликов: скроллбар периметра и контент живут своей жизнью. */
export function AssistantEdgeEntry() {
  const railHidden = useRailHidden();
  const open = useAssistantStore((s) => s.open);
  const setOpen = useAssistantStore((s) => s.setOpen);
  const [visible, setVisible] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inTimer = useRef(0);
  const outTimer = useRef(0);
  const visibleRef = useRef(false);
  visibleRef.current = visible;
  const targetY = useRef(0);
  const currentY = useRef(0);

  useEffect(() => {
    if (!railHidden || open) {
      setVisible(false);
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clampY = (y: number) => Math.min(Math.max(y, 8), window.innerHeight - 44);
    const paint = () => {
      const el = btnRef.current;
      if (el) el.style.transform = `translate3d(0, ${currentY.current}px, 0)`;
    };
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(now - last, 100);
      last = now;
      const delta = targetY.current - currentY.current;
      if (Math.abs(delta) < 0.1) return;
      // Демпфирование ПО ВРЕМЕНИ (τ≈90 мс): одинаковая плавность на 60/144 fps
      // и без слоу-мо при просадке кадров — покадровый коэффициент давал лаг.
      currentY.current += reduce ? delta : delta * (1 - Math.exp(-dt / 90));
      paint();
    };
    raf = requestAnimationFrame(tick);
    const clearIn = () => window.clearTimeout(inTimer.current);
    const clearOut = () => window.clearTimeout(outTimer.current);
    const onMove = (event: PointerEvent) => {
      const nearEdge = event.clientX >= window.innerWidth - 24;
      if (nearEdge) {
        clearOut();
        targetY.current = clampY(event.clientY - 18);
        if (!visibleRef.current) {
          // Первый подвод: кнопка рождается у курсора, дальше — плавная погоня.
          currentY.current = targetY.current;
          paint();
          inTimer.current = window.setTimeout(() => setVisible(true), 250);
        }
      } else {
        clearIn();
        outTimer.current = window.setTimeout(() => setVisible(false), 150);
      }
    };
    // Кромка экрана — сама аффорданс: pointerdown у правого края открывает
    // окно СРАЗУ, не дожидаясь hover-намеренности кнопки (иначе первые
    // 1-2 клика после закрытия панели уходили в невидимую кнопку, вердикт
    // владельца 16.11.2026). На /chat ползунка периметра нет — перехвата нет.
    const onDown = (event: PointerEvent) => {
      if (event.clientX >= window.innerWidth - 24) setOpen(true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      clearIn();
      clearOut();
    };
  }, [railHidden, open, setOpen]);

  if (!railHidden || open) return null;

  return (
    // Нативный button, НЕ shadcn Button: база примитива несёт свои
    // rounded-*/border, и правые углы/бордюр «выезжающей из кромки» кнопки
    // переживали twMerge (вердикт владельца 16.11.2026: правые края ровные).
    <button
      ref={btnRef}
      type="button"
      // Заморозка ТОЛЬКО на pointerdown: кнопка встаёт под клик (down+up по
      // одному элементу), иначе движущаяся цель теряла 2-3 клика (вердикт
      // владельца 16.11.2026). На hover не замораживаем — была осцилляция.
      onPointerDown={() => {
        targetY.current = currentY.current;
      }}
      onClick={() => setOpen(true)}
      aria-label={ui.assistant.openHint}
      title={ui.assistant.openHint}
      className={cn(
        // ВПЛОТНУЮ к правому краю (right-0): курсор у самой кромки экрана
        // должен попадать В кнопку, а не правее неё (терялись 2-3 клика).
        // На /chat ползунка периметра нет (канон edge-scrollbar).
        // Правые углы ПРЯМЫЕ, правого бордюра/тени НЕТ: кнопка читается
        // выезжающей из кромки экрана; скруглены только левые углы.
        'fixed top-0 right-0 z-[60] flex size-9 items-center justify-center rounded-l-xl border-y border-l border-border bg-card text-primary will-change-transform hover:text-primary-hover',
        'outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/40',
        'transition-opacity duration-200',
        // invisible в покое: скрытая кнопка вне tab-order (a11y), opacity
        // остаётся анимируемой; visibility переключается дискретно.
        visible ? 'opacity-100' : 'invisible pointer-events-none opacity-0',
      )}
    >
      <Bot className="size-4" />
    </button>
  );
}
