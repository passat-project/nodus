import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { VideoControlBar, HALL_CONTROL_CLASS } from './video-control-bar.js';
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

/** Пробел на кнопке/ссылке — их собственное нажатие; на фоне и ползунках — пуск/пауза. */
function spaceBelongsToTarget(target: EventTarget | null): boolean {
  return !(target instanceof HTMLElement) || target.closest('button, a, [role="button"]') === null;
}

/**
 * Клавиши зала на всём слое: после клика по ползунку/кнопке фокус уходит с
 * кадра, а команды зала должны работать (нативная полоса такого ограничения
 * не имела — её события всплывали на `<video>`). Кадр свои клавиши уже
 * обработал (`defaultPrevented`) — здесь только остаток.
 */
function handleHallKey(event: KeyboardEvent<HTMLDivElement>, player: VideoPlayer) {
  if (event.defaultPrevented) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === ' ') {
    if (!spaceBelongsToTarget(event.target)) return;
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
      onKeyDown={(event) => handleHallKey(event, player)}
    >
      <header
        className="flex h-12 shrink-0 items-center gap-2 bg-black px-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white/90" title={name}>
          {name}
        </p>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className={cn('text-white/60 hover:bg-white/10 hover:text-white', HALL_CONTROL_CLASS)}
        >
          <a href={url} download={name} aria-label={ui.files.download} title={ui.files.download}>
            <Download />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('text-white/60 hover:bg-white/10 hover:text-white', HALL_CONTROL_CLASS)}
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
          // Кадр — единственное «большое» действие зала (клик = пуск/пауза):
          // курсор говорит о нажимаемости, фокус-рамка рисуется ВНЕ кадра
          // (offset), а не поверх изображения — контент не перекрывается.
          className="max-h-full max-w-full cursor-pointer object-contain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
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
