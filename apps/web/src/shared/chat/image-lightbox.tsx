import { ChevronLeft, ChevronRight, Minus, Plus, Scan, X } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { MessageAttachment } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { useImageZoom } from '../files/use-image-zoom.js';
import { LightboxFrame } from './lightbox-frame.js';
/**
 * Лайтбокс изображения галереи (plan chat-attachments-plan, добро владельца
 * 14.09.2026): портал поверх интерфейса (z-80), Esc и клик по заднику —
 * закрыть, стрелки клавиатуры и кнопки по краям — листание, счётчик «N / M»
 * слева сверху. Полноэкранное изображение — БЕЗ скруглений (#151: в углах
 * может быть важная информация; скругления — только у миниатюр в ленте).
 * Фокус при открытии — на диалоге, при закрытии возвращается плитке галереи
 * (a11y); клики по самому фото и кнопкам не закрывают диалог. Кадр, загрузка
 * и ретрай — `lightbox-frame.tsx`.
 *
 * Зум (#721): 100% — натуральные пиксели, вписывание — «по размеру экрана»
 * с полями 15%. Стрелки делят две роли (решение #721): фокус в области
 * просмотра И картинка больше окна — стрелки сдвигают её (панорама), иначе —
 * листают галерею, как раньше; `+`/`−`/`0` работают только при фокусе в
 * области. Смена кадра сбрасывает масштаб и сдвиг.
 *
 * Хром (вердикт владельца 25.11.2026): фон — СПЛОШНОЕ затемнение всего экрана
 * (кадр остаётся ярким), а строка масштаба с крестиком плавает свободной
 * группой в тёмном поле НАД кадром и закреплена у верхней кромки (середина
 * стандартного поля 15%) — от размера кадра не зависит, у маленькой картинки
 * не сползает в середину экрана. Так значки не читаются рядом с кнопками окна
 * оболочки и не накрывают фото; компактные плашки под счётчиком и группой
 * держат контраст, когда увеличенный кадр уходит под хром.
 */

/** Кнопки масштаба в группе хрома: белые ghost-значки крупнее обычных. */
const CONTROL_CLASS =
  "text-white hover:bg-white/15 hover:text-white [&_svg:not([class*='size-'])]:size-5";

/** Доля экрана под вписанную картинку — те же поля, что у кадра лайтбокса. */
const FIT_FACTOR = 0.85;

/**
 * Пауза перед закрытием по клику на задник. Первый клик двойного приходит
 * РАНЬШЕ события `dblclick`, поэтому мгновенное закрытие выбрасывало из
 * просмотра вместо переключения масштаба (живая проверка 11.11). Пауза ниже
 * системного порога двойного клика (Windows — 500 мс): одиночный клик
 * закрывает почти сразу, а быстрый двойной успевает отменить закрытие.
 */
const BACKDROP_CLOSE_DELAY = 400;

export function ImageLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: MessageAttachment[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const image = images[index];
  // Зум живёт на весь лайтбокс, но сбрасывается сменой кадра (resetKey).
  const zoom = useImageZoom({ fitFactor: FIT_FACTOR, resetKey: image?.id });

  // Хром закреплён у верхней кромки — середина стандартного поля 15% (эталон
  // владельца 25.11.2026): у большого кадра он у верха, как на скриншоте 1,
  // а у маленького НЕ сползает в середину экрана, как на 2. От размера кадра
  // позиция не зависит.
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? 0 : window.innerHeight,
  );
  useEffect(() => {
    const measure = () => setViewportHeight(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const chromeTop = (viewportHeight * 0.075) / 2;

  // Отложенное закрытие по заднику (см. BACKDROP_CLOSE_DELAY): второй клик
  // пары или `dblclick` его отменяют — двойной клик только меняет масштаб.
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  useEffect(() => cancelClose, []);

  const onBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Клик принадлежит лайтбоксу и не всплывает до карточки поста (#409).
    event.stopPropagation();
    if (event.detail > 1) {
      cancelClose();
      return;
    }
    if (closeTimer.current !== null) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      onClose();
    }, BACKDROP_CLOSE_DELAY);
  };

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    boxRef.current?.focus();
    return () => restoreTo?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Capture + stopPropagation: Esc гасит ТОЛЬКО лайтбокс, даже открытый
      // поверх Radix-диалога (окно отправки вложений, #144) — иначе document-
      // слушатель DismissableLayer закрыл бы и диалог под ним.
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      // Стрелки — панораме, только когда фокус в области просмотра И картинка
      // больше окна: тогда обработчик области (следующим шагом) сдвигает её.
      // Во всех остальных случаях стрелки листают галерею, как раньше.
      if (zoom.canPan && zoom.areaRef.current === document.activeElement) return;
      if (event.key === 'ArrowRight') onIndex(Math.min(index + 1, images.length - 1));
      else onIndex(Math.max(index - 1, 0));
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, images.length, onClose, onIndex, zoom.canPan, zoom.areaRef]);

  if (!image) return null;

  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-modal="true"
      aria-label={image.name}
      tabIndex={-1}
      /* Клик по заднику закрывает лайтбокс (с паузой под двойной клик) и НЕ
         всплывает дальше: портал живёт в body, но React-событие всплывает по
         дереву компонентов до карточки поста, и та открывала обсуждение (#409). */
      onClick={onBackdropClick}
      onDoubleClick={cancelClose}
      /* Поверх Radix-модалки (окно отправки вложений, #144): модал ставит
         body pointer-events:none, портал в body наследует это — лайтбокс
         был «прозрачен» для мыши, а клики мимо уходили в html и закрывали
         модал. pointer-events-auto возвращает хит-тест; pointerdown не
         всплывает до document-слушателей DismissableLayer модала. */
      onPointerDown={(event) => event.stopPropagation()}
      className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center bg-black/85 outline-none"
    >
      {/* Хром — свободная строка в тёмном поле над кадром (вердикт 25.11.2026):
          фон сплошной, кадр яркий и не накрыт; строка закреплена у верхней
          кромки (середина стандартного поля) и от размера кадра не зависит —
          у маленькой картинки не сползает в середину экрана. Компактные
          плашки держат контраст, когда увеличенный кадр уходит под хром. */}
      <div
        role="toolbar"
        aria-label={ui.files.zoomPanel}
        className="absolute inset-x-0 z-20 -translate-y-1/2 px-6"
        style={{ top: chromeTop }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full bg-black/35 px-2.5 py-1 font-mono text-xs tabular-nums text-white backdrop-blur-sm">
            {index + 1} / {images.length}
          </span>
          <div className="flex items-center gap-1 rounded-2xl bg-black/35 p-1 pr-2 text-white backdrop-blur-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={zoom.zoomOut}
              disabled={!zoom.canZoomOut}
              aria-label={ui.files.zoomOut}
              title={ui.files.zoomOut}
              className={CONTROL_CLASS}
            >
              <Minus />
            </Button>
            <span className="w-12 text-center text-[13px] tabular-nums">{zoom.percent}%</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={zoom.zoomIn}
              disabled={!zoom.canZoomIn}
              aria-label={ui.files.zoomIn}
              title={ui.files.zoomIn}
              className={CONTROL_CLASS}
            >
              <Plus />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={zoom.reset}
              aria-label={ui.files.zoomFit}
              title={ui.files.zoomFit}
              className={`${CONTROL_CLASS} ml-1`}
            >
              <Scan />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={ui.common.close}
              title={ui.common.close}
              className="ml-1 size-10 border-white/25 bg-black/45 text-white hover:border-white/40 hover:bg-white/15 hover:text-white [&_svg:not([class*='size-'])]:size-5"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              <X />
            </Button>
          </div>
        </div>
      </div>
      {index > 0 ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={ui.chat.photoPrev}
          className="absolute left-3 z-20 text-white hover:bg-white/15"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index - 1);
          }}
        >
          <ChevronLeft />
        </Button>
      ) : null}
      {index < images.length - 1 ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={ui.chat.photoNext}
          className="absolute right-3 z-20 text-white hover:bg-white/15"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index + 1);
          }}
        >
          <ChevronRight />
        </Button>
      ) : null}
      <LightboxFrame image={image} zoom={zoom} />
    </div>,
    document.body,
  );
}
