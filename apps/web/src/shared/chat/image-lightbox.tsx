import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { MessageAttachment } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { useImageZoom } from '../files/use-image-zoom.js';
import { ViewerZoomBar } from '../files/viewer-zoom-bar.js';
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
 * Зум (#721): та же панель масштаба, что у вложений (`ViewerZoomBar`), в той
 * же верхней полосе; 100% — натуральные пиксели, вписывание — «по размеру
 * экрана» с полями 15%. Стрелки делят две роли (решение #721): фокус в
 * области просмотра И картинка больше окна — стрелки сдвигают её (панорама),
 * иначе — листают галерею, как раньше; `+`/`−`/`0` работают только при фокусе
 * в области. Смена кадра сбрасывает масштаб и сдвиг.
 */

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
      {/* Хром лайтбокса — ОТДЕЛЬНЫЙ слой над кадром (z-20 против z-0 кадра).
          Подложка СПЛОШНАЯ (`bg-black/60` + blur), не градиент: на светлом
          скриншоте градиентный скрим не читался и полоса сливалась с фото
          (живая проверка 11.11). Справа `pr-12` — место под крестик, чтобы
          группа масштаба его не наезжала. */}
      <div className="absolute inset-x-0 top-0 z-20" onClick={(event) => event.stopPropagation()}>
        <ViewerZoomBar
          leading={`${index + 1} / ${images.length}`}
          leadingClassName="font-mono text-xs tabular-nums text-white"
          percent={zoom.percent}
          canZoomIn={zoom.canZoomIn}
          canZoomOut={zoom.canZoomOut}
          onZoomIn={zoom.zoomIn}
          onZoomOut={zoom.zoomOut}
          onReset={zoom.reset}
          className="bg-black/60 pr-12 text-white/90 backdrop-blur-sm"
          controlClassName="text-white hover:bg-white/15 hover:text-white"
        />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={ui.common.close}
        className="absolute top-1 right-3 z-20 text-white hover:bg-white/15"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X />
      </Button>
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
