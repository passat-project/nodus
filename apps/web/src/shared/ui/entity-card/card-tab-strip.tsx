import { X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/** Вкладка правой зоны карточки сущности (задача/письмо/проект). */
export interface CardTabDef {
  id: string;
  label: string;
  icon: ReactNode;
  /** Счётчик непрочитанного/количества — моно у подписи. */
  badge?: number;
  /** Подсказка полного имени (файловые вкладки). */
  title?: string;
  /** Закрываемая вкладка (вложения); «Чат»/«Письмо»/разделы — постоянные. */
  closable?: boolean;
}

/**
 * Полоса вкладок правой зоны — ОДНА на все карточки (устраняет рассинхрон
 * «в проекте светлая, в задаче чёрная»): h-10, фон карточки (`bg-card`),
 * нижняя граница, активная — `border-port`; справа — слот действий карточки
 * (меню, «О задаче», «+» разделов, тоггл панели). Вкладки монтируются и
 * живут скрытыми у хоста — здесь только полоса.
 */
export function CardTabStrip({
  label,
  tabs,
  active,
  onActivate,
  onClose,
  trailing,
  actions,
  hint,
  idPrefix,
  onKeyDown,
  groupId,
  onTabPointerDown,
  onTabContextMenu,
  draggingTabId,
  stripRef,
}: {
  /** aria-label полосы. */
  label: string;
  tabs: CardTabDef[];
  active: string;
  onActivate: (id: string) => void;
  onClose?: (id: string) => void;
  /** Действие сразу за вкладками (например, «+» разделов проекта). */
  trailing?: ReactNode;
  /** Правый слот действий карточки (фиксирован, не скроллится с вкладками). */
  actions?: ReactNode;
  /** Подсказка derived-состояния ширины (#746) — в слоте хрома, НЕ поверх
   *  контента: панель беседы скрыта / вторая область свёрнута. */
  hint?: ReactNode;
  /** Префикс id вкладок/панелей (связка aria-controls). */
  idPrefix?: string;
  /** ←/→ по полосе — соседняя вкладка (хост решает). */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  /** Ссылка на скролл-контейнер полосы (замеры для линии вставки). */
  stripRef?: (el: HTMLDivElement | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  // Активная вкладка для RO-колбэка: полоса ужимается панелью беседы/подсказкой
  // и DnD-сплитом — активную нельзя оставлять обрезанной за правым слотом.
  const activeRef = useRef(active);
  activeRef.current = active;
  // Оверлейный индикатор прокрутки: нативный скроллбар скрыт (data-no-scrollbar),
  // поэтому его появление НЕ съедает высоту полосы — вкладки не подпрыгивают.
  const [scroll, setScroll] = useState({
    thumb: 0,
    left: 0,
    overflow: false,
    atStart: true,
    atEnd: true,
  });
  const updateScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) {
      setScroll({ thumb: 0, left: 0, overflow: false, atStart: true, atEnd: true });
      return;
    }
    const track = Math.max(0, el.clientWidth - 24);
    const thumb = Math.max(24, (el.clientWidth / el.scrollWidth) * track);
    setScroll({
      thumb,
      left: (el.scrollLeft / max) * (track - thumb),
      overflow: true,
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= max - 1,
    });
  }, []);
  /** Активная вкладка вышла за видимую часть полосы (ужали панель/слот) —
   *  подкручиваем БЕЗ анимации: это не смена вкладки, а коррекция ресайза. */
  const revealActive = useCallback(() => {
    const el = listRef.current;
    const tab = tabRefs.current.get(activeRef.current);
    if (!el || !tab) return;
    const strip = el.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.left < strip.left - 1 || box.right > strip.right + 1) {
      tab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
  }, []);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    updateScroll();
    // Колесо мыши по полосе листает вкладки по горизонтали (нативный
    // скроллбар скрыт): вертикальный deltaY переводим в scrollLeft.
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener('scroll', updateScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            updateScroll();
            revealActive();
          });
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScroll);
      el.removeEventListener('wheel', onWheel);
      observer?.disconnect();
    };
  }, [revealActive, updateScroll]);
  useEffect(() => {
    updateScroll();
  }, [tabs.length, updateScroll]);
  // Активная вкладка всегда видна: при нехватке места (панель беседы/файлы)
  // полоса подкручивается к ней, а не оставляет её за краем.
  useEffect(() => {
    const el = tabRefs.current.get(active);
    if (!el || typeof el.scrollIntoView !== 'function') return;
    el.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [active, tabs.length]);

  // Края прокрутки гаснут маской: полоса не «режет» подпись пополам —
  // обрыв читается как продолжение (иначе «тория» торчала у края).
  const EDGE_FADE = 18;
  const maskImage = scroll.overflow
    ? `linear-gradient(to right, ${scroll.atStart ? 'black' : 'transparent'} 0, black ${EDGE_FADE}px, black calc(100% - ${EDGE_FADE}px), ${scroll.atEnd ? 'black' : 'transparent'} 100%)`
    : undefined;

  return (
    <div className="flex h-10 shrink-0 items-center">
      <div className="relative h-10 min-w-0 flex-1">
        <div
          ref={(el) => {
            listRef.current = el;
            stripRef?.(el);
          }}
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          data-no-scrollbar
          data-card-tab-strip
          data-group-id={groupId}
          style={maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined}
          className="content-fade flex h-10 min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden px-3"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <div
                key={tab.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(tab.id, el);
                  else tabRefs.current.delete(tab.id);
                }}
                data-card-tab-id={tab.id}
                className={cn(
                  'flex h-10 shrink-0 items-center border-b-2 transition-colors',
                  isActive
                    ? 'border-port text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground/80',
                  draggingTabId === tab.id && 'opacity-40',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  id={idPrefix ? `${idPrefix}-${tab.id.replace(':', '-')}-tab` : undefined}
                  aria-selected={isActive}
                  aria-controls={
                    idPrefix ? `${idPrefix}-${tab.id.replace(':', '-')}-panel` : undefined
                  }
                  tabIndex={isActive ? 0 : -1}
                  title={tab.title}
                  onClick={() => onActivate(tab.id)}
                  onPointerDown={(event) => onTabPointerDown?.(tab.id, event)}
                  onContextMenu={(event) => onTabContextMenu?.(tab.id, event)}
                  className={cn(
                    // Фокус — ИНСЕТНЫЙ outline: полоса вкладок скроллится по X
                    // (overflow-y-hidden), наружный outline обрезался бы снизу.
                    'flex h-full max-w-48 min-w-0 items-center gap-1.5 text-body-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/70',
                    tab.closable ? 'pr-1 pl-2' : 'px-2.5',
                  )}
                >
                  <span aria-hidden className="shrink-0 opacity-80">
                    {tab.icon}
                  </span>
                  <span className="truncate">{tab.label}</span>
                  {tab.badge ? (
                    // Активная вкладка счётчик не показывает, но МЕСТО держит:
                    // иначе при переключении подпись и соседи прыгают влево.
                    <span
                      aria-hidden={isActive || undefined}
                      className={cn(
                        'font-mono text-label-sm text-port tabular-nums',
                        isActive && 'invisible',
                      )}
                    >
                      {tab.badge}
                    </span>
                  ) : null}
                </button>
                {tab.closable ? (
                  <button
                    type="button"
                    data-no-tab-drag
                    onClick={() => onClose?.(tab.id)}
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label={`${ui.common.closeTab}: ${tab.label}`}
                    title={ui.common.closeTab}
                    className="mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/70"
                  >
                    <X className="size-3.5" strokeWidth={1.75} />
                  </button>
                ) : null}
              </div>
            );
          })}
          {trailing ? <div className="ml-1 flex h-10 shrink-0 items-center">{trailing}</div> : null}
        </div>
        {scroll.overflow ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-0 h-0.5">
            <div
              className="h-full rounded-full bg-[var(--scrollbar)]"
              style={{ width: scroll.thumb, transform: `translateX(${scroll.left}px)` }}
            />
          </div>
        ) : null}
      </div>
      {hint || actions ? (
        <div className="flex h-10 shrink-0 items-center gap-1.5 pr-2">
          {hint}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
