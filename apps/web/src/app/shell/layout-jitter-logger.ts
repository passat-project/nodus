import { wsDebugLog, wsDebugEnabled } from '../../shared/socket/ws-debug.js';

/**
 * Диагностика «весь контент карточки дёргается влево на ~3px» (#132 р.11):
 * по коду карточки позиционны (absolute inset-2 / flex-1 в overflow-hidden
 * рамке) и сдвигаться не могут — значит на кадр выскакивает наш 3px
 * тонкий скроллбар в контейнере, держащем весь контент; какой именно —
 * статически не видно. Ловим измерением: при `?wsdebug=1` каждый кадр
 * сравниваем left/width ключевых контейнеров (рамка и её прямые дети,
 * карточка стека и её дети, колонки мессенджера, скролл-контейнеры) и
 * печатаем ТОЛЬКО изменения ≥0.5px — владелец открывает трэд, копирует
 * строки [jitter] из консоли, агент читает механизм.
 */
interface WatchPoint {
  label: string;
  selector: string;
  /** Сколько первых совпадений наблюдать (одинаковых колонок несколько). */
  limit: number;
}

const WATCH: WatchPoint[] = [
  { label: 'рамка страницы', selector: '.frame-shadow', limit: 1 },
  { label: 'ребёнок рамки (контент-хост)', selector: '.frame-shadow > *', limit: 4 },
  { label: 'карточка стека', selector: '.slider-shadow', limit: 2 },
  { label: 'ребёнок карточки стека', selector: '.slider-shadow > *', limit: 4 },
  { label: 'колонка-aside', selector: 'aside', limit: 3 },
  { label: 'скроллер сообщений', selector: '[data-slot="message-scroller-viewport"]', limit: 3 },
  { label: 'скролл-контейнер', selector: '[class*="overflow-y-auto"]', limit: 6 },
];

const THRESHOLD_PX = 0.5;

export function startLayoutJitterLogger(): () => void {
  if (!wsDebugEnabled || typeof window === 'undefined') return () => {};
  const prev = new Map<Element, { left: number; width: number }>();
  let lastLogAt = 0;
  let frame = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    // Коалесцируем: не чаще ~5 строк/с — читаемый журнал одного дёрганья.
    const quiet = now - lastLogAt > 200;
    for (const point of WATCH) {
      for (const el of Array.from(document.querySelectorAll(point.selector)).slice(
        0,
        point.limit,
      )) {
        const rect = el.getBoundingClientRect();
        const before = prev.get(el);
        prev.set(el, { left: rect.left, width: rect.width });
        if (!before || !quiet) continue;
        const dLeft = rect.left - before.left;
        const dWidth = rect.width - before.width;
        if (Math.abs(dLeft) >= THRESHOLD_PX || Math.abs(dWidth) >= THRESHOLD_PX) {
          lastLogAt = now;
          wsDebugLog(
            `[jitter] ${point.label}: left ${before.left.toFixed(1)}→${rect.left.toFixed(1)} (${dLeft >= 0 ? '+' : ''}${dLeft.toFixed(1)}) · width ${before.width.toFixed(1)}→${rect.width.toFixed(1)} (${dWidth >= 0 ? '+' : ''}${dWidth.toFixed(1)}) · <${el.tagName.toLowerCase()} class="${el.className.toString().slice(0, 60)}">`,
          );
        }
      }
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}
