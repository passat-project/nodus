import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { MessageAttachment } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import type { ImageZoom } from '../files/use-image-zoom.js';

/**
 * Кадр лайтбокса (#221 → #721): прогрессивная загрузка, фейд после decode,
 * авто-ретрай, область зума с жестами. Хром лайтбокса (портал, счётчик,
 * панель масштаба, стрелки-листание) — `image-lightbox.tsx`.
 *
 * Размер кадра (#221): вписывание в min(natural, 85vw, 85vh·ratio) —
 * крупные вписываются в экран (Telegram-модель: downscale-only), мелкие
 * остаются в natural 1:1, апскейла нет (канон PhotoPrism viewport-mapping и
 * headless-lightbox minCoverage=0; research #221). Бокс вписывания задаётся
 * ЯВНЫМИ габаритами оригинала — контейнер не сжимается под потоковую
 * миниатюру (прошлая верстка рендерила 2400px-оригинал в 800px-бокс).
 *
 * Прогрессивная загрузка (#150): пока грузится оригинал, кадр держит
 * миниатюра (кэш ленты) — обе absolute в одном аспект-боксе, пиксель в
 * пиксель (модель Medium). Фейд — только после подтверждённого декодирования
 * (img.decode(), MDN); сбой загрузки не молчит: авто-ретрай ×1 (ремоунт по
 * key), затем явная плашка «не удалось загрузить» с повтором.
 */

/** Источники кадра: полный = оригинал (url), миниатюра — только промежуточный
 *  кадр; равные источники не дублируются. Чистая — unit-тест (#221:
 *  регрессия «лайтбокс показывает url, а не thumbnailUrl»). */
export function resolveLightboxSources(image: Pick<MessageAttachment, 'url' | 'thumbnailUrl'>): {
  fullSrc: string;
  thumbSrc: string | null;
} {
  const fullSrc = image.url ?? image.thumbnailUrl ?? '';
  const thumbSrc = image.thumbnailUrl && image.thumbnailUrl !== fullSrc ? image.thumbnailUrl : null;
  return { fullSrc, thumbSrc };
}

/** Кадр показа из габаритов оригинала: явный aspect-бокс шириной
 *  min(85vw, 85vh·ratio, natural) — крупное вписывается в экран, мелкое
 *  остаётся 1:1. Без габаритов (старые строки) — null, потоковый фолбэк.
 *  Чистая — unit-тест. */
export function lightboxFrameStyle(
  width?: number | null,
  height?: number | null,
): CSSProperties | null {
  if (!width || width <= 0 || !height || height <= 0) return null;
  const ratio = width / height;
  return {
    width: `min(85vw, calc(85vh * ${ratio}), ${Math.round(width)}px)`,
    aspectRatio: `${width} / ${height}`,
  };
}

type FullPhase = 'loading' | 'ready' | 'error';

export function LightboxFrame({ image, zoom }: { image: MessageAttachment; zoom: ImageZoom }) {
  const { fullSrc, thumbSrc } = resolveLightboxSources(image);
  const frame = lightboxFrameStyle(image.width, image.height);
  const [phase, setPhase] = useState<FullPhase>('loading');
  const [attempt, setAttempt] = useState(0);
  const fullRef = useRef<HTMLImageElement>(null);
  // Начало жеста: отличает клик по заднику (закрыть) от протяжки (панорама)
  // и от нажатия на само фото (не закрывает).
  const gesture = useRef<{
    x: number;
    y: number;
    moved: boolean;
    onImage: boolean;
  } | null>(null);

  // Листание галереи: новый кадр начинает загрузку заново (до кадра, без
  // вспышки прошлого состояния — layout-эффект).
  useLayoutEffect(() => {
    setPhase('loading');
    setAttempt(0);
  }, [image.id]);

  const showFull = () => {
    const settle = () => setPhase('ready');
    const img = fullRef.current;
    // Фейд после декодирования: без decode пустой кадр/мигание на больших PNG
    if (img && typeof img.decode === 'function') img.decode().then(settle, settle);
    else settle();
  };
  const failFull = () => {
    if (attempt < 1)
      setAttempt(attempt + 1); // один авто-ретрай — новый <img>
    else setPhase('error');
  };
  const retry = () => {
    setPhase('loading');
    setAttempt(attempt + 1);
  };
  const loaded = (event: { currentTarget: HTMLImageElement }) => {
    zoom.onImageLoad(event);
    showFull();
  };

  const indicator =
    phase === 'loading' && thumbSrc ? (
      <span
        role="status"
        aria-label={ui.chat.lightboxLoading}
        className="absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-full bg-black/55 p-1.5 text-white/85"
      >
        <Loader2 className="size-4 animate-spin" />
      </span>
    ) : null;

  const error =
    phase === 'error' ? (
      <span
        role="alert"
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 flex min-w-72 flex-col items-center justify-center gap-2 rounded-sm bg-black/65 text-white"
      >
        <AlertTriangle className="size-6 text-white/85" />
        <span className="text-sm">{ui.chat.lightboxLoadError}</span>
        <Button variant="outline" size="sm" onClick={retry}>
          {ui.chat.lightboxRetry}
        </Button>
      </span>
    ) : null;

  // Пока оригинал не загружен, бокс держат габариты из метаданных (тот же
  // размер, что даст вписывание) — кадр не прыгает на появлении оригинала.
  const boxStyle: CSSProperties | null = zoom.ready
    ? zoom.imageStyle
    : frame
      ? { ...frame, transform: zoom.imageStyle.transform }
      : null;

  const frameImages = (
    <>
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt={image.name}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 size-full object-contain"
        />
      ) : null}
      <img
        key={attempt}
        ref={fullRef}
        src={fullSrc}
        alt={image.name}
        // Без этого браузер начинает НАТИВНЫЙ drag картинки: pointermove
        // прекращается, жест панорамирования не доезжает до хука (картинка
        // «не двигалась» при 125% — живая проверка 11.11).
        draggable={false}
        onLoad={loaded}
        onError={failFull}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute inset-0 size-full object-contain transition-opacity duration-200',
          phase === 'ready' ? 'opacity-100' : 'opacity-0',
        )}
      />
      {indicator}
      {error}
    </>
  );

  const startGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      moved: false,
      // Нажатие на само фото — не «клик по заднику». Считать нужно ЗДЕСЬ:
      // после `setPointerCapture` клик переадресуется области, и `onClick`
      // картинки уже не срабатывает (иначе клик по фото закрывал лайтбокс).
      onImage: (event.target as Element | null)?.closest('img') != null,
    };
    zoom.onPointerDown(event);
  };
  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (start && !start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3) {
      start.moved = true;
    }
    zoom.onPointerMove(event);
  };
  const endGesture = (event: ReactMouseEvent<HTMLDivElement>) => {
    const start = gesture.current;
    // Протяжка — это панорамирование, а не «клик по заднику»: иначе отпускание
    // мыши/пальца после сдвига картинки закрывало бы лайтбокс. Нажатие на фото
    // тоже не закрывает — как было до зума.
    if (start?.moved || start?.onImage) event.stopPropagation();
  };

  return (
    <div
      ref={zoom.areaRef}
      role="group"
      aria-label={ui.files.imageArea}
      tabIndex={0}
      onPointerDown={startGesture}
      onPointerMove={moveGesture}
      onPointerUp={zoom.onPointerUp}
      onPointerCancel={zoom.onPointerCancel}
      onKeyDown={zoom.onKeyDown}
      onDoubleClick={zoom.onDoubleClick}
      onClick={endGesture}
      // Нативный dragstart гасим и здесь: страховка на случай элементов,
      // которые браузер сам считает перетаскиваемыми.
      onDragStart={(event) => event.preventDefault()}
      className={cn(
        'relative z-0 flex size-full touch-none items-center justify-center overflow-hidden outline-none select-none',
        'focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-inset',
        zoom.canPan && (zoom.dragging ? 'cursor-grabbing' : 'cursor-grab'),
      )}
    >
      {boxStyle ? (
        <span
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          style={boxStyle}
        >
          {frameImages}
        </span>
      ) : (
        // Фолбэк без габаритов: прежняя потоковая схема, но с обработкой ошибок.
        <span className="relative inline-flex max-h-[85vh] min-h-48 min-w-72 max-w-[85vw]">
          {thumbSrc ? (
            <img
              src={thumbSrc}
              alt={image.name}
              draggable={false}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[85vh] max-w-[85vw] object-contain"
            />
          ) : null}
          <img
            key={attempt}
            ref={fullRef}
            src={fullSrc}
            alt={image.name}
            draggable={false}
            onLoad={loaded}
            onError={failFull}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'max-h-[85vh] max-w-[85vw] object-contain transition-opacity duration-200',
              thumbSrc && 'absolute inset-0 size-full',
              phase === 'ready' || (!thumbSrc && phase !== 'error') ? 'opacity-100' : 'opacity-0',
            )}
          />
          {indicator}
          {error}
        </span>
      )}
    </div>
  );
}
