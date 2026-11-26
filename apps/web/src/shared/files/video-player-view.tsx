import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { VideoControlBar, HALL_CONTROL_CLASS } from './video-control-bar.js';
import { handleVideoSeekKey, seekVideoByKey } from './video-seek-keys.js';
import { useVideoPlayer, type VideoPlayer } from './use-video-player.js';

/** Через сколько полоса управления прячется во время игры (модель Telegram). */
const CONTROLS_HIDE_MS = 2500;
/** Шаг громкости ↑/↓ — как у нативных медиа-контролов (5%). */
const VOLUME_STEP = 0.05;

/**
 * «Кинозал» видео (#787, решение владельца 11.11.2026): видео открывается
 * не в карточке файла (её шапка — хром документов: версия, «Редактировать»),
 * а во весь экран. Плеер вписан по обеим осям с сохранением пропорций
 * (`object-contain`) — поля по краям читаются как кадр зала. Слой закрывает
 * весь экран, включая верхнюю панель приложения; фон — полупрозрачное
 * тёмно-серое затемнение (`neutral-900/80`, #790): портал под роликом
 * приглушён, но виден. Сверху тонкая строка: имя, «Скачать», закрыть.
 * Закрытие — плашка со скруглением нашего контрола и обводкой, а не голый
 * крестик (25.11.2026, как в лайтбоксе).
 *
 * Портал z-80 — тот же слой, что у лайтбокса.
 *
 * Кадр не притемняется нативным градиентом (#1054): браузерная полоса
 * Chromium рисовала тёмный скрим ПОВЕРХ низа ролика. Здесь `<video>` без
 * `controls`, а внизу — своя ПЛАВАЮЩАЯ СЕРАЯ панель `VideoControlBar`
 * в духе Telegram (уточнение владельца 26.11.2026): звук, пуск/пауза,
 * шестерёнка скорости (0.5–2×) и ползунок; появляется по движению мыши
 * и на фокусе, через 2,5 с игры прячется, на паузе и конце видна всегда.
 * Медиа-хром зала — фиксированная серая шкала в обеих темах; тема его не
 * перекрашивает.
 *
 * Если кодек не поддержан — вместо кадра табличка «Не удалось
 * воспроизвести — Скачать»: в плитке ленты остаётся постер, результат
 * открытия известен только здесь.
 *
 * Клавиатура: фокус ставится на `<video>` при открытии явно — React
 * `autoFocus` для медиаэлементов не работает (`commitMount` фокусирует
 * только button/input/select/textarea/img), без этого ←/→ уходили в
 * интерфейс под плеером. `tabIndex={0}` вдобавок не даёт «вечному курсору»
 * композера утащить фокус из оверлея: он не трогает элементы с tabIndex ≥ 0.
 * ←/→ — свои ±5 с (`handleVideoSeekKey`), в том числе с кнопок панели после
 * паузы (фокус на кнопке, а не на кадре); ↑/↓ — громкость шагом 5% (как у
 * нативных контролов); пробел и M — пуск/пауза и звук: однобуквенные
 * сокращения работают только при фокусе в плеере (WCAG 2.1.4), модификаторы
 * не перехватываем.
 *
 * Полного экрана в зале нет: web Fullscreen API оставлял системную полосу
 * внизу (панель Windows/браузера не контролируется порталом), а нативный
 * fullscreen видео давал чужой плеер без крестика (`docs/gotchas/frontend.md`).
 * Зал и так раскрыт на всё окно; настоящий полный экран — системный F11/окно.
 */
function handlePlayerKey(event: KeyboardEvent<HTMLVideoElement>, player: VideoPlayer) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  handleVideoSeekKey(event);
  if (event.defaultPrevented) return;
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    player.nudgeVolume(event.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP);
    return;
  }
  if (event.key === ' ') {
    event.preventDefault();
    player.togglePlay();
    return;
  }
  if (event.code === 'KeyM') {
    event.preventDefault();
    player.toggleMute();
  }
}

/** Пробел на кнопке/ссылке — их собственное нажатие; на фоне и ползунках — пуск/пауза. */
function spaceBelongsToTarget(target: EventTarget | null): boolean {
  return !(target instanceof HTMLElement) || target.closest('button, a, [role="button"]') === null;
}

/** Стрелки на ползунке/поле — их собственное нажатие: не перематывать кадр. */
function arrowsBelongToControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, [contenteditable="true"], [role="slider"]') !== null
  );
}

/**
 * Клавиши зала на всём слое: после клика по ползунку/кнопке фокус уходит с
 * кадра, а команды зала должны работать (нативная полоса такого ограничения
 * не имела — её события всплывали на `<video>`). Кадр свои клавиши уже
 * обработал (`defaultPrevented`) — здесь только остаток. Стрелки — на кнопках
 * панели (после паузы фокус на «Пауза»), но не на ползунках: там шаг
 * принадлежит самому `input`.
 */
function handleHallKey(
  event: KeyboardEvent<HTMLDivElement>,
  player: VideoPlayer,
  video: HTMLVideoElement | null,
) {
  if (event.defaultPrevented) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (video && !arrowsBelongToControl(event.target)) {
    if (seekVideoByKey(video, event.key)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      player.nudgeVolume(event.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP);
      return;
    }
  }
  if (event.key === ' ') {
    if (!spaceBelongsToTarget(event.target)) return;
    event.preventDefault();
    player.togglePlay();
    return;
  }
  if (event.code === 'KeyM') {
    event.preventDefault();
    player.toggleMute();
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
  const barRef = useRef<HTMLDivElement>(null);
  const errorLinkRef = useRef<HTMLAnchorElement>(null);
  const hideTimer = useRef<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const player = useVideoPlayer({ playerRef, src: url });

  // Смена файла — новый кадр и новый результат открытия.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  useEffect(() => {
    // preventScroll — канон программного фокуса (#132): не двигать предков.
    if (!failed) playerRef.current?.focus({ preventScroll: true });
  }, [url, failed]);

  // Ошибка воспроизведения: фокус — на «Скачать», а не в никуда.
  useEffect(() => {
    if (failed) errorLinkRef.current?.focus({ preventScroll: true });
  }, [failed]);

  const clearHide = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const poke = useCallback(() => {
    setControlsVisible(true);
    clearHide();
    // Открытое меню скорости — часть панели: пока оно на экране, не прячем.
    if (!player.playing || speedOpen) return;
    hideTimer.current = window.setTimeout(() => {
      // Не прятать панель из-под клавиатурного фокуса: Tab по кнопкам не
      // должен «проваливать» управление в невидимые элементы.
      if (barRef.current?.contains(document.activeElement)) return;
      setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, [clearHide, player.playing, speedOpen]);

  // Показ по открытию/смене файла; на play — запуск таймера, на паузу — показ.
  useEffect(() => {
    poke();
    return clearHide;
  }, [poke, clearHide, url]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-[80] flex flex-col bg-neutral-900/80"
      // Задник закрывает; клики по кадру, шапке, панели и табличке — нет.
      onClick={onClose}
      onMouseMove={poke}
      onPointerDown={poke}
      onKeyDown={(event) => {
        poke();
        handleHallKey(event, player, playerRef.current);
      }}
    >
      <header
        className="flex h-12 shrink-0 items-center gap-2 bg-neutral-900 px-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100" title={name}>
          {name}
        </p>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className={cn(
            'text-neutral-400 hover:bg-white/10 hover:text-neutral-100',
            HALL_CONTROL_CLASS,
          )}
        >
          <a href={url} download={name} aria-label={ui.files.download} title={ui.files.download}>
            <Download />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          className="border-white/15 bg-neutral-700/60 text-neutral-100 backdrop-blur-sm hover:border-white/25 hover:bg-neutral-600/70 hover:text-white"
          onClick={onClose}
          aria-label={ui.files.close}
          title={ui.files.close}
        >
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {/* Кадр и панель — ОДИН блок: панель сразу под кадром, по центру,
            как в Telegram (уточнение владельца 26.11.2026). */}
        <div className="flex max-h-full min-h-0 max-w-full flex-col items-center gap-2">
          {failed ? (
            <div
              role="alert"
              className="max-w-md rounded-xl border border-neutral-600 bg-neutral-800/95 px-5 py-4 text-center text-sm leading-relaxed text-neutral-100"
              onClick={(event) => event.stopPropagation()}
            >
              {ui.chat.videoUnsupported}{' '}
              <a
                ref={errorLinkRef}
                href={url}
                download={name}
                className="font-medium underline underline-offset-2 hover:no-underline"
              >
                {ui.files.download}
              </a>
            </div>
          ) : (
            <>
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
                className="min-h-0 max-h-full max-w-full cursor-pointer object-contain focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
                aria-label={name}
                onKeyDown={(event) => handlePlayerKey(event, player)}
                onClick={(event) => {
                  // Клик по кадру — пуск/пауза, а не закрытие зала.
                  event.stopPropagation();
                  poke();
                  player.togglePlay();
                }}
                onError={() => setFailed(true)}
              />
              <div
                ref={barRef}
                className={cn(
                  'flex w-full justify-center transition-opacity duration-200',
                  controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
                onFocusCapture={poke}
              >
                <VideoControlBar
                  player={player}
                  onSpeedOpenChange={setSpeedOpen}
                  className="max-w-[24rem]"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
