import { Minus, Plus, Scan } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { ViewerFullscreenButton } from './viewer-fullscreen-button.js';

/**
 * Панель масштаба просмотрщика (#138 → #721): ЕДИНЫЙ примитив PDF, вложений
 * и лайтбокса чата — грамматика взята у PDF-панели («−», процент, «+»), чтобы
 * вложения открывались одним просмотрщиком. Строка h-9 на фоне карточки:
 * слева — статус хоста (страница PDF, счётчик галереи), справа — масштаб,
 * «по размеру окна» и «на весь экран» (та же ghost-иконка, вердикт 04.11).
 *
 * Слой: панель — `relative z-10`, то есть отдельная плоскость над контентом —
 * увеличенный кадр/страница не может её накрыть, пан и скролл её не двигают.
 * Подложка у панели СВОЯ (`bg-card`, плоско — канон «без градиентов»), так что
 * читаемость не зависит от хоста; исключение — тёмный оверлей (лайтбокс):
 * он переопределяет фон классами (`bg-black/60` + blur) и цвет текста.
 */
export function ViewerZoomBar({
  leading,
  leadingTitle,
  percent,
  canZoomIn = true,
  canZoomOut = true,
  onZoomIn,
  onZoomOut,
  onReset,
  onFullscreen,
  className,
  controlClassName,
  leadingClassName,
}: {
  /** Левый слот: статус документа (страница PDF); у картинки пусто. */
  leading?: string;
  leadingTitle?: string;
  percent: number;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** «По размеру окна» — кнопка есть там, где вписывание не единственный режим. */
  onReset?: () => void;
  onFullscreen?: () => void;
  className?: string;
  /** Классы кнопок: на тёмной подложке лайтбокса свои цвета (ghost «белым»). */
  controlClassName?: string;
  /** Классы левого слота: моно-счётчик галереи лайтбокса. */
  leadingClassName?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label={ui.files.zoomPanel}
      className={cn(
        'relative z-10 flex h-9 shrink-0 items-center justify-between gap-2 bg-card px-4 text-[13px] text-muted-foreground',
        className,
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate', leadingClassName)} title={leadingTitle}>
        {leading}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onZoomOut}
          disabled={!canZoomOut}
          aria-label={ui.files.zoomOut}
          title={ui.files.zoomOut}
          className={controlClassName}
        >
          <Minus />
        </Button>
        <span className="w-12 text-center tabular-nums">{percent}%</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onZoomIn}
          disabled={!canZoomIn}
          aria-label={ui.files.zoomIn}
          title={ui.files.zoomIn}
          className={controlClassName}
        >
          <Plus />
        </Button>
        {onReset ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onReset}
            aria-label={ui.files.zoomFit}
            title={ui.files.zoomFit}
            className={cn('ml-1', controlClassName)}
          >
            <Scan />
          </Button>
        ) : null}
        {onFullscreen ? (
          <ViewerFullscreenButton onClick={onFullscreen} className={cn('ml-1', controlClassName)} />
        ) : null}
      </div>
    </div>
  );
}
