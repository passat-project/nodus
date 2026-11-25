import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { Button } from '@nodus/ui/components/button';

import { VideoControlBar } from './video-control-bar.js';
import { handleVideoSeekKey } from './video-seek-keys.js';
import { useVideoPlayer, type VideoPlayer } from './use-video-player.js';

/**
 * «Кинозал» видео (#787, решение владельца 11.11.2026): видео открывается
 * не в карточке файла (её шапка — хром документов: версия, «Редактировать»),
 * а во весь экран. Плеер вписан по обеим осям с сохранением пропорций
 * (`object-contain`) — поля по краям читаются как кадр зала.
 *
 * Фон — полупрозрачное затемнение `black/75` (#790): портал под роликом
 * приглушён, но виден. Портал z-80 — тот же слой, что у лайтбокса.
 *
 * Кадр чистый (#1054, указание владельца 25.11.2026): браузерная полоса
 * управления Chromium рисовала тёмный градиент ПОВЕРХ нижней части ролика
 * и перекрывала содержимое записи. Теперь `<video>` без `controls`, а
 * кнопки — своей полосой ПОД кадром (`VideoControlBar`) на фоне зала:
 * тёмный фон остаётся, кадр не притемняется никогда.
 *
 * Клавиатура: фокус ставится на `<video>` при открытии явно — React
 * `autoFocus` для медиаэлементов не работает (`commitMount` фокусирует
 * только button/input/select/textarea/img), без этого ←/→ уходили в
 * интерфейс под плеером. `tabIndex={0}` вдобавок не даёт «вечному курсору»
 * композера утащить фокус из оверлея: он не трогает элементы с tabIndex ≥ 0.
 * ←/→ — свои ±5 с (`handleVideoSeekKey`); пробел, M и F — пуск/пауза, звук
 * и полный экран: однобуквенные сокращения работают только при фокусе в
 * плеере (WCAG 2.1.4), модификаторы не перехватываем.
 */
function handlePlayerKey(event: KeyboardEvent<HTMLVideoElement>, player: VideoPlayer) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  handleVideoSeekKey(event);
  if (event.defaultPrevented) return;
  if (event.key === ' ') {
    event.preventDefault();
    player.togglePlay();
    return;
  }
  if (event.code === 'KeyM') {
    event.preventDefault();
    player.toggleMute();
    return;
  }
  if (event.code === 'KeyF') {
    event.preventDefault();
    player.toggleFullscreen();
  }
}

export function VideoPlayerView({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const playerRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const player = useVideoPlayer({ playerRef, containerRef: dialogRef, src: url });

  useEffect(() => {
    // preventScroll — канон программного фокуса (#132): не двигать предков.
    playerRef.current?.focus({ preventScroll: true });
  }, [url]);

  const close = useCallback(() => {
    // Закрытие из полноэкранного режима: сначала выходим из него, иначе
    // браузер оставил бы полноэкранным уже размонтированный слой.
    if (document.fullscreenElement === dialogRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }
    onClose();
  }, [onClose]);

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-[80] flex flex-col bg-black/75"
      // Задник закрывает; клики по кадру, шапке и полосе — нет (stopPropagation).
      onClick={close}
    >
      <header
        className="flex h-12 shrink-0 items-center gap-2 bg-black px-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="min-w-0 flex-1 truncate text-sm text-white/90" title={name}>
          {name}
        </p>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="text-white/70 hover:bg-white/10 hover:text-white"
        >
          <a href={url} download={name} aria-label={ui.files.download} title={ui.files.download}>
            <Download />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white/70 hover:bg-white/10 hover:text-white"
          onClick={close}
          aria-label={ui.files.close}
          title={ui.files.close}
        >
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <video
          ref={playerRef}
          key={url}
          src={url}
          autoPlay
          preload="auto"
          tabIndex={0}
          playsInline
          className="max-h-full max-w-full object-contain"
          aria-label={name}
          onKeyDown={(event) => handlePlayerKey(event, player)}
          onClick={(event) => {
            // Клик по кадру — пуск/пауза, а не закрытие зала.
            event.stopPropagation();
            player.togglePlay();
          }}
        />
      </div>

      <VideoControlBar player={player} />
    </div>,
    document.body,
  );
}
