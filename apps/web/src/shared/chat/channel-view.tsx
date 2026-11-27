import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { usePaneWidth } from '../ui/use-pane-width.js';
import { hasOpenPopperLayer } from '../lib/overlay-layers.js';
import {
  isSideBySide,
  MIN_THREAD_W,
  THREAD_DEFAULT_W,
  THREAD_MAX_W,
  threadMaxW,
  threadWidth,
} from './channel-layout.js';
import { ThreadFeed } from './thread-feed.js';
import { ThreadPane } from './thread-pane.js';

/**
 * Канал (новости компании / канал проекта): лента постов-тредов + окно треда
 * (вердикт владельца 11.09.2026, #42; research — Slack «Weaving Threads»:
 * тред — отдельная панель, не оверлей и не замена ленты). Окно треда —
 * ПОЛНОВЫСОТНАЯ колонка-сиблинг (вердикт владельца 15.09.2026, приём панели
 * беседы): её бар стоит НА ЛИНИИ баров хоста (`threadBarClass`: мессенджер
 * h-14, проект h-10); в шапке окна справа — крестик «Закрыть» у края колонки
 * (вердикт 25.11.2026, #1061; полоса поста — тумблер «Обсудить →/Свернуть ←»,
 * Esc тоже закрывает); бар беседы
 * (`header`) живёт в колонке ленты и сжимается вместе с ней — тоггл панели
 * на его правом краю. Перегородка тянется мышью с памятью
 * (`nodus-thread-w-v2`,
 * императивный drag по канону use-chat-width); открытие — вталкивание окна
 * шириной (transition-[width], как панель «О задаче»); transition — ТОЛЬКО
 * на toggle: при внешнем resize контейнера окно следует 1:1 (гейт
 * containerMoving, issue #65 — иначе «гармошка»/пружина ленты). Узкая зона
 * (< 640px: лента 320 + тред 320) — фолбэк drill-down: тред заменяет ленту с
 * кнопкой «К ленте» (бар беседы остаётся). Посты ленты сжимаются с лентой
 * (w-full max-w-2xl).
 *
 * СВЯЗИ «пост → тред» НЕТ (вердикт владельца 15.09.2026): грамматика
 * контура — для ПОСТОЯННОЙ структуры (рейка, вкладки, рамка), а пост —
 * движущийся контент (скролл/подгрузка ломали замер); бары — запретная зона
 * для связей. Семантику «к какому посту тред» несёт корневой пост внутри
 * окна. Панель беседы — ОДНА на беседу у контейнера страницы/карточки,
 * при открытом треде — области «Вся беседа / Этот тред».
 */
export function ChannelView({
  conversationId,
  threadRootId,
  onOpenThread,
  onCloseThread,
  header,
  threadBarClass = 'h-14',
  canPost,
}: {
  conversationId: string;
  threadRootId: string | null;
  onOpenThread: (rootId: string) => void;
  onCloseThread: () => void;
  /** Доменный гейт ленты (канал проекта: объявления — только руководство). */
  canPost?: boolean;
  /** Бар беседы — рендерится в колонке ленты (сжимается вместе с ней при
   *  открытии треда); у карточки проекта своего бара нет — не передаётся. */
  header?: ReactNode;
  /** Высота бара треда = высота бара хоста (линии border-b продолжаются
   *  друг в друга — канон панели беседы). */
  threadBarClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  // Контейнер меняет ширину ИЗВНЕ (drag колонки чата, рефлоу рельсы, окно
  // браузера): в это время цель ширины окна перевязывается ре-рендером
  // КАЖДЫЙ кадр (threadWidth клампится контейнером), и transition на окне
  // отстаёт eased-шагами — лента-пружина забирает дефицит ниже своего
  // минимума, а контент окна клипится переходящим краем рывками («гармошка»,
  // баг-репорт 21.09.2026, issue #65). Канон переходов: transition — только
  // для toggle (открытие/закрытие окна), resize контейнера окно отрабатывает
  // 1:1 без анимации. Пометка живёт до оседания ресайза (~150мс тишины RO).
  const [containerMoving, setContainerMoving] = useState(false);
  const settleTimer = useRef(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onResize = () => {
      setContainerW(el.clientWidth);
      setContainerMoving(true);
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => setContainerMoving(false), 150);
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(settleTimer.current);
    };
  }, []);

  // Живой верхний предел ширины окна: потолок THREAD_MAX_W, пол — минимум
  // окна, между ними — контейнер минус лента и перегородка (threadMaxW —
  // единственная формула); запомненная ширина клампится им же
  // (use-pane-width) — drag стартует от эффективной ширины без скачка на
  // первом пикселе (вердикт валидатора #42).
  const maxW = containerW ? threadMaxW(containerW) : THREAD_MAX_W;
  const { width, onDividerDown, dragging } = usePaneWidth({
    storeKey: 'nodus-thread-w-v2',
    defaultW: THREAD_DEFAULT_W,
    minW: MIN_THREAD_W,
    maxW,
    paneRef,
  });

  // Обёртка окна монтируется СРАЗУ и ПОСТОЯННО (w-0), контент — при открытии
  // (приём панели беседы, баг-вердикт 15.09.2026: «окно треда после
  // перезагрузки первый раз появляется резко»): свежий элемент, рождённый
  // в целевой ширине, transition не даёт — обёртка обязана СТОЯТЬ в DOM в
  // покое до первого открытия, тогда transition идёт с первого кадра даже
  // после Ctrl+R. Скролл ленты при открытии/закрытии не теряется.
  const open = threadRootId !== null;
  const side = open && isSideBySide(containerW);
  const effW = threadWidth(width, containerW || THREAD_MAX_W);

  // Esc закрывает тред (критерий приёмки #42). Radix-меню/поповеры съедают
  // Esc сами (defaultPrevented + popper-обёртка в DOM) — приём SliderPanel.
  // Capture-фаза + preventDefault: внутренний слой ПОТРЕБЛЯЕТ клавишу, иначе
  // один Esc закрывал бы и тред, и карточку слайдера поверх (канон «один
  // Escape = один слой», вердикт валидатора #42).
  useEffect(() => {
    if (!threadRootId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (hasOpenPopperLayer()) return;
      // Слойность (канон «один Escape = один слой», ADR-0009): если поверх
      // страницы с тредом открыта карточка слайдера — клавиша её, фоновый
      // тред молчит; тред ВНУТРИ верхней карточки закрывается как обычно.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs.length > 0) {
        const top = dialogs[dialogs.length - 1];
        const mine = containerRef.current?.closest('[role="dialog"]') ?? null;
        if (top !== mine) return;
      }
      e.preventDefault();
      onCloseThread();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [threadRootId, onCloseThread]);

  return (
    <div ref={containerRef} className="relative flex h-full min-w-0 flex-1">
      {open && !side ? (
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {header}
          <ThreadPane
            conversationId={conversationId}
            threadRootId={threadRootId}
            variant="drill"
            onClose={onCloseThread}
          />
        </div>
      ) : (
        <>
          {/* Колонка ленты: бар беседы живёт ЗДЕСЬ и сжимается вместе с
              лентой при открытии треда — тоггл панели на его правом краю
              (вердикт владельца 15.09.2026). */}
          <div className="flex h-full min-w-0 flex-1 flex-col">
            {header}
            <div className="min-h-0 min-w-0 flex-1">
              <ThreadFeed
                conversationId={conversationId}
                onOpenThread={onOpenThread}
                onCloseThread={onCloseThread}
                openThreadId={threadRootId}
                canPost={canPost}
              />
            </div>
          </div>
          {/* Обёртка окна и перегородка — ВСЕГДА в DOM (w-0 в покое, см.
              комментарий выше: первое открытие после перезагрузки плавное);
              aria-hidden на контейнере НЕ ставим: он вырезал бы ручку
              role=separator из дерева доступности. */}
          <div
            className={cn(
              'relative w-px shrink-0 bg-border transition-opacity',
              !open && 'opacity-0',
            )}
          >
            {open ? (
              <div
                onPointerDown={onDividerDown}
                role="separator"
                aria-orientation="vertical"
                aria-label={ui.common.resizePanel}
                title={ui.common.resizePanel}
                className="absolute top-0 -left-1.5 z-10 h-full w-3 cursor-col-resize"
              />
            ) : null}
          </div>
          <div
            ref={paneRef}
            aria-hidden={!open}
            className={cn(
              'h-full shrink-0 overflow-hidden',
              // transition — только для toggle открытия/закрытия и drag-
              // коммита; пока контейнер меняет ширину (containerMoving) —
              // окно следует 1:1 (issue #65: с transition — «гармошка»).
              !dragging && !containerMoving && 'transition-[width] duration-200 ease-out',
            )}
            style={{ width: open ? effW : 0 }}
          >
            <div className="h-full" style={{ width: dragging ? '100%' : effW }}>
              {open ? (
                <ThreadPane
                  conversationId={conversationId}
                  threadRootId={threadRootId}
                  variant="side"
                  barClass={threadBarClass}
                  onClose={onCloseThread}
                />
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
