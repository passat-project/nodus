import { useEffect, useRef, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';

import { ImageViewer } from './image-viewer.js';
import { handleVideoSeekKey } from './video-seek-keys.js';
import { ViewerFullscreenButton } from './viewer-fullscreen-button.js';

/**
 * Сцена медиа — flex, не grid (#767): у ребёнка auto-строки грида
 * процентный `max-height` циклический (строка считается по intrinsic-вкладу
 * элемента, CSS Sizing 3) и высоту не ограничивает — видео рисовалось
 * «по ширине» и вылезало за панель вместе с полосой управления. Flex-
 * контейнер с определённой высотой даёт проценту базу, и медиа ужимается
 * по обеим осям с сохранением пропорций (max-w/max-h у replaced-элемента).
 */
function MediaStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-full min-h-0 min-w-0 items-center justify-center p-6">{children}</div>
  );
}

/**
 * Медиа-вьюер (#138): видео/аудио — нативные элементы браузера (controls),
 * без зависимостей. Изображение открывается `ImageViewer` (#721: зум,
 * панорамирование, панель масштаба одной грамматики с PDF) — полноэкранный
 * контент БЕЗ скруглений (#151, вердикт владельца 29.09: в углах картинки
 * может быть важная информация); скругления остаются у миниатюр в ленте.
 *
 * Фокус плеера (#1005): у `<video>`/`<audio>` `autoFocus`-атрибут React
 * игнорирует (`commitMount` знает только input-подобные теги) — ставим
 * фокус ref'ом, иначе ←/→ не перематывают (работают лишь при фокусе на
 * медиаэлементе).
 */
export function MediaViewer({
  url,
  mime,
  name,
  fit,
  autoFocus = true,
  onFullscreen,
}: {
  url: string;
  mime: string;
  name: string;
  /** Изображение по ширине панели со скроллом (скан письма, #55). */
  fit?: 'width';
  /** Фокус на плеере при открытии: видео — да (стрелки/пробел — управление
   *  воспроизведением); поля ввода карточки при этом не затронуты. */
  autoFocus?: boolean;
  /** «На весь экран»: у картинки — в панели масштаба, у плеера — поверх. */
  onFullscreen?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const player = mime.startsWith('video/') ? videoRef.current : audioRef.current;
    player?.focus({ preventScroll: true });
  }, [autoFocus, mime, url]);

  if (mime.startsWith('video/')) {
    return (
      <MediaStage>
        <video
          ref={videoRef}
          key={url}
          src={url}
          controls
          tabIndex={0}
          playsInline
          className="max-h-full max-w-full object-contain"
          aria-label={name}
          onKeyDown={handleVideoSeekKey}
        />
        {onFullscreen ? (
          <ViewerFullscreenButton onClick={onFullscreen} className="absolute top-3 right-3 z-10" />
        ) : null}
      </MediaStage>
    );
  }
  if (mime.startsWith('audio/')) {
    return (
      <div className="relative grid size-full place-items-center p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-4">
          <span className="text-sm text-muted-foreground">{ui.files.mediaTitle}</span>
          <audio ref={audioRef} key={url} src={url} controls tabIndex={0} className="w-full" />
        </div>
        {onFullscreen ? (
          <ViewerFullscreenButton onClick={onFullscreen} className="absolute top-3 right-3 z-10" />
        ) : null}
      </div>
    );
  }
  return <ImageViewer url={url} name={name} fit={fit} onFullscreen={onFullscreen} />;
}
