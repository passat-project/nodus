import { useEffect, useState, type RefObject } from 'react';

/**
 * Плавающая дата над лентой (#997, вердикт владельца 23.11.2026): сверху по
 * центру — полупрозрачная плашка с датой той части переписки, которая сейчас
 * видна. Живёт в корне `MessageScroller` (absolute над вьюпортом), дату берёт
 * у настоящих дата-чипов ленты: показывается, когда чип дня ПОЛНОСТЬЮ ушёл за
 * верхнюю кромку — пока чип виден, дата не дублируется.
 *
 * Механика — геометрия чипов на скролле (rAF-троттл) и на изменении размера
 * контента (догрузка истории/вложения/стрим): дата-чипы живут ВНУТРИ серий и
 * групп, поэтому примитив visibility их не видит; маркер `[data-day-chip]`
 * ставит сам `DayChip`. Чистая `labelAboveTop` — unit-тест без DOM.
 */

export interface DayChipGeometry {
  label: string;
  /** Верх чипа в координатах вьюпорта (getBoundingClientRect). */
  top: number;
  /** Низ чипа в тех же координатах. */
  bottom: number;
}

/**
 * Дата, которую держит верхняя кромка: последний чип, чей ВЕРХ ушёл за кромку,
 * и только если сам чип уже не виден (низ выше кромки). Иначе null — дата
 * видна в обычном чипе, дублировать не нужно.
 */
export function labelAboveTop(
  chips: readonly DayChipGeometry[],
  viewportTop: number,
): string | null {
  let active: DayChipGeometry | null = null;
  for (const chip of chips) {
    // DOM-порядок = хронология: как только верх чипа ниже кромки, он и все
    // следующие — не «выше».
    if (chip.top >= viewportTop) break;
    active = chip;
  }
  return active !== null && active.bottom <= viewportTop ? active.label : null;
}

/** Наблюдение за датой у верхней кромки вьюпорта ленты. */
export function useDayLabelAboveTop(viewportRef: RefObject<HTMLElement | null>): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const chips: DayChipGeometry[] = [];
      for (const el of viewport.querySelectorAll<HTMLElement>('[data-day-chip]')) {
        const rect = el.getBoundingClientRect();
        chips.push({
          label: el.dataset.dayLabel ?? '',
          top: rect.top,
          bottom: rect.bottom,
        });
      }
      setLabel(labelAboveTop(chips, viewport.getBoundingClientRect().top));
    };
    // Первый замер — сразу после коммита: дата нужна при открытии чата, не
    // после прокрутки. Повтор в следующем кадре — на осевшую раскладку
    // (якорь открытия/догрузка), таймер — страховка холодного монтирования.
    measure();
    const schedule = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(measure);
    };
    schedule();
    const initial = window.setTimeout(schedule, 350);
    viewport.addEventListener('scroll', schedule, { passive: true });

    // Рост/сжатие контента без скролла: догрузка истории сверху, вложения,
    // стрим ассистента — дата у кромки могла смениться.
    const content =
      viewport.querySelector<HTMLElement>('[data-slot="message-scroller-content"]') ??
      viewport.firstElementChild;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(viewport);
    if (content) observer?.observe(content);

    return () => {
      window.clearTimeout(initial);
      viewport.removeEventListener('scroll', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [viewportRef]);

  return label;
}

/** Плашка с датой над лентой: декоративная, указатель не перехватывает. */
export function DayBubble({ viewportRef }: { viewportRef: RefObject<HTMLElement | null> }) {
  const label = useDayLabelAboveTop(viewportRef);
  if (!label) return null;
  return (
    <div
      data-slot="day-bubble"
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-3"
    >
      <span className="rounded-full border border-border bg-card/90 px-2.5 py-1 font-mono text-label-sm tracking-wide text-muted-foreground uppercase shadow-none backdrop-blur-sm">
        {label}
      </span>
    </div>
  );
}
