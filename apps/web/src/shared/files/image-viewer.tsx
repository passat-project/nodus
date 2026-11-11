import { ui } from '@nodus/contracts';

import { cn } from '@nodus/ui/lib/utils';

import { useImageZoom } from './use-image-zoom.js';
import { ViewerZoomBar } from './viewer-zoom-bar.js';

/**
 * Просмотр изображения (#721): зум 25–400% панелью (та же, что у PDF),
 * `Ctrl`/`⌘`+колесо и пинч тачпада, перетаскивание мышью/пальцем, двойной
 * клик «по размеру окна ↔ 100%», клавиши `+`/`−`/`0` и стрелки. Скан письма
 * (`fit="width"`, #55) открывается по ширине панели — зум масштабирует от неё.
 *
 * Картинка позиционируется от центра области: масштаб — размеры в CSS-
 * пикселях (не transform: scale — так качество растра не зависит от
 * композитора), сдвиг — `translate`, клампы не дают краю уехать за окно.
 */
export function ImageViewer({
  url,
  name,
  fit,
  onFullscreen,
}: {
  url: string;
  name: string;
  fit?: 'width';
  /** «На весь экран» в панели масштаба (вкладка-просмотрщик). */
  onFullscreen?: () => void;
}) {
  const zoom = useImageZoom({ fit });

  return (
    <div className="flex size-full flex-col">
      <ViewerZoomBar
        percent={zoom.percent}
        canZoomIn={zoom.canZoomIn}
        canZoomOut={zoom.canZoomOut}
        onZoomIn={zoom.zoomIn}
        onZoomOut={zoom.zoomOut}
        onReset={zoom.reset}
        onFullscreen={onFullscreen}
      />
      {/* Область просмотра — фокусируемая: клавиши масштаба работают только
          когда фокус здесь, Esc остаётся у модалки (обработчик на документе). */}
      <div
        ref={zoom.areaRef}
        role="group"
        aria-label={ui.files.imageArea}
        title={ui.files.imageZoomHint}
        tabIndex={0}
        onPointerDown={zoom.onPointerDown}
        onPointerMove={zoom.onPointerMove}
        onPointerUp={zoom.onPointerUp}
        onPointerCancel={zoom.onPointerCancel}
        onKeyDown={zoom.onKeyDown}
        onDoubleClick={zoom.onDoubleClick}
        className={cn(
          // `flex-1 min-h-0` (не `size-full`): область занимает остаток под
          // панелью, а не полную высоту хоста — иначе кадр вылезал за низ на
          // высоту панели и центрировался со сдвигом.
          'relative z-0 min-h-0 w-full flex-1 touch-none overflow-hidden bg-muted/40 select-none outline-none',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset',
          zoom.canPan && (zoom.dragging ? 'cursor-grabbing' : 'cursor-grab'),
        )}
      >
        <img
          key={url}
          src={url}
          alt={name}
          draggable={false}
          onLoad={zoom.onImageLoad}
          style={zoom.imageStyle}
          className={cn(
            'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            zoom.ready ? 'max-w-none' : 'max-h-full max-w-full object-contain',
          )}
        />
      </div>
    </div>
  );
}
