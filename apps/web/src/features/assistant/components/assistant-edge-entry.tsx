import { Bot } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { uiPx } from '../../../shared/ui/ui-scale.js';
import { useAssistantStore } from '../model/assistant-store.js';
import { useAssistantEnabled } from '../model/use-assistant-enabled.js';

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
 *  НЕ перехватчик кликов. мгновенное открытие по pointerdown — ТОЛЬКО в щели
 *  периметра (uiPx(8)) и только ЛКМ по не-интерактивной цели: собственный
 *  скроллбар ленты и правая кромка композера живут левее и не перехватываются
 *  (замечание валидации 16.11.2026). railHidden — пропом из шелла (канон
 *  features→app: rail-visibility не в whitelist). */
export function AssistantEdgeEntry({ railHidden }: { railHidden: boolean }) {
  const enabled = useAssistantEnabled();
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
    if (!enabled || !railHidden || open) {
      setVisible(false);
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clampY = (y: number) => Math.min(Math.max(y, uiPx(8)), window.innerHeight - uiPx(44));
    const paint = () => {
      const el = btnRef.current;
      if (el) el.style.transform = `translate3d(0, ${currentY.current}px, 0)`;
    };
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(now - last, 100);
      last = now;
      const delta = targetY.current - currentY.current;
      // Осел — спим (канон императивных циклов: rAF только на время
      // взаимодействия), просыпаемся от pointermove у кромки.
      if (Math.abs(delta) < 0.1) return;
      // Демпфирование ПО ВРЕМЕНИ (τ≈90 мс): одинаковая плавность на 60/144 fps
      // и без слоу-мо при просадке кадров — покадровый коэффициент давал лаг.
      currentY.current += reduce ? delta : delta * (1 - Math.exp(-dt / 90));
      paint();
      raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const clearIn = () => window.clearTimeout(inTimer.current);
    const clearOut = () => window.clearTimeout(outTimer.current);
    const onMove = (event: PointerEvent) => {
      const nearEdge = event.clientX >= window.innerWidth - uiPx(24);
      if (nearEdge) {
        clearOut();
        targetY.current = clampY(event.clientY - uiPx(18));
        wake();
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
    // Кромка экрана — сама аффорданс: pointerdown в ЩЕЛИ периметра открывает
    // окно СРАЗУ, не дожидаясь hover-намеренности кнопки (иначе первые
    // 1-2 клика после закрытия панели уходили в невидимую кнопку, вердикт
    // владельца 16.11.2026). Только ЛКМ и не по интерактивной цели: скроллбар
    // ленты/композер/кнопки левее щели и не перехватываются.
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.clientX < window.innerWidth - uiPx(8)) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, a, input, textarea, [role="scrollbar"]')
      )
        return;
      setOpen(true);
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
  }, [enabled, railHidden, open, setOpen]);

  if (!enabled || !railHidden || open) return null;

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
