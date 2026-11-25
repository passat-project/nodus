import { Maximize2, Minimize2, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import type { CSSProperties } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { formatVideoDuration } from '../lib/format.js';
import type { VideoPlayer } from './use-video-player.js';

/**
 * Полоса управления кинозала (#1054) — ПОД кадром, на тёмном фоне зала.
 * Кадр не перекрывается ничем: браузерная полоса Chromium рисовала над ним
 * градиент и притемняла низ ролика (`docs/gotchas/frontend.md`).
 *
 * Разметка — тулбар с кнопками и нативными `input[type=range]`: клавиатура,
 * скринридер и объявление значений перемотки достаются от платформы
 * (WAI-ARIA: ползунок с `aria-valuetext`, имя у каждой кнопки).
 */

// Ползунок рисуем САМИ (#1054): линия, заливка и кружок — одной геометрией, кружок
// ровно по центру линии и ровно в позиции значения. Нативный thumb/дорожка
// прозрачные, но input остаётся сверху — клавиатура, скринридер и drag от
// платформы. Почему не нативные дорожка+thumb: Chromium ставит UA-дорожку ниже
// центра input (замер: кружок на 5px ниже линии; сама UA-дорожка — на 8px ниже
// центра зоны захвата), плюс UA-thumb не даёт выровнять кружок по краям 1:1.
// `--knob` — размер кружка: центр едет от 0,5·кружка до 100% − 0,5·кружка.

/** Позиция кружка/заливки: процент значения с поправкой на радиус кружка на краях. */
function knobPosition(percent: number): string {
  const p = Math.min(100, Math.max(0, percent));
  return `calc(${p}% + (var(--knob, 0.75rem) / 2) - ${p / 100} * var(--knob, 0.75rem))`;
}

/** Прозрачные UA-контролы: вид рисуют наши слои, поведение — input. */
const RANGE_CLASS = cn(
  'absolute top-1/2 left-0 h-6 w-full -translate-y-1/2 appearance-none bg-transparent outline-none',
  '[&::-webkit-slider-runnable-track]:h-5 [&::-webkit-slider-runnable-track]:bg-transparent',
  '[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-transparent',
  '[&::-moz-range-track]:h-5 [&::-moz-range-track]:bg-transparent',
  '[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent',
);

/** Дорожка с фокус-кольцом: кольцо темы (`--ring` индиго) на чёрном не видно. */
const TRACK_CLASS = cn(
  'relative h-1 rounded-full bg-white/20',
  '[--knob:0.75rem]',
  '[&:has(:focus-visible)]:outline-2 [&:has(:focus-visible)]:outline-offset-2 [&:has(:focus-visible)]:outline-white/70',
);

/** Заливка и кружок — декоративные слои под input'ом, указатель не перехватывают. */
const FILL_CLASS = 'pointer-events-none absolute inset-y-0 left-0 rounded-full bg-white/85';
const KNOB_CLASS =
  'pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white';

/**
 * Хром зала ВСЕГДА на чёрном (обе темы) — фокус-кольцо темы (`--ring` индиго)
 * на чёрном даёт ~1.3:1 и не читается: кнопки зала рисуют фокус белым.
 * Экспортируется в шапку: правила у бара и шапки одни.
 */
export const HALL_CONTROL_CLASS = 'focus-visible:border-white/60 focus-visible:ring-white/40';

/** Пуск/пауза — единственная команда полосы «в полную силу» (ось 2: якорь зала). */
const PLAY_BUTTON_CLASS = cn('text-white hover:bg-white/10', HALL_CONTROL_CLASS);
/** Служебные команды (звук, полный экран) — тише транспорта, тот же вес, что у шапки. */
const UTILITY_BUTTON_CLASS = cn(
  'text-white/60 hover:bg-white/10 hover:text-white',
  HALL_CONTROL_CLASS,
);

export function VideoControlBar({
  player,
  className,
  style,
}: {
  player: VideoPlayer;
  className?: string;
  style?: CSSProperties;
}) {
  const current = formatVideoDuration(player.time * 1000);
  const total = formatVideoDuration(player.duration * 1000);
  const played = player.duration > 0 ? Math.min(100, (player.time / player.duration) * 100) : 0;
  const volume = player.muted ? 0 : Math.round(player.volume * 100);

  const playLabel = player.ended
    ? ui.files.replay
    : player.playing
      ? ui.files.pause
      : ui.files.play;

  return (
    <div
      role="toolbar"
      aria-label={ui.files.videoControls}
      // pl-1.5: иконка пуска встаёт на одну вертикаль с именем файла в шапке
      // (внутренний отступ icon-кнопки ровно pl-1.5) — левый край хрома один.
      className={cn('flex h-12 shrink-0 items-center gap-1.5 bg-black pr-3 pl-1.5', className)}
      style={style}
      // Клик по полосе — не «мимо плеера»: кинозал не закрывается.
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={PLAY_BUTTON_CLASS}
        onClick={player.togglePlay}
        aria-label={playLabel}
        title={playLabel}
      >
        {player.ended ? <RotateCcw /> : player.playing ? <Pause /> : <Play />}
      </Button>

      <span className="min-w-[5.25rem] shrink-0 font-mono text-xs tabular-nums text-white/60">
        {current} / {total}
      </span>

      <div className={cn('mx-1 min-w-0 flex-1', TRACK_CLASS)}>
        <span aria-hidden className={FILL_CLASS} style={{ width: knobPosition(played) }} />
        <span aria-hidden className={KNOB_CLASS} style={{ left: knobPosition(played) }} />
        <input
          type="range"
          min={0}
          max={player.duration || 0}
          step="any"
          value={Math.min(player.time, player.duration || 0)}
          onChange={(event) => player.seekTo(Number(event.target.value))}
          disabled={player.duration === 0}
          aria-label={ui.files.seek}
          aria-valuetext={`${current} ${ui.files.timeOf} ${total}`}
          className={RANGE_CLASS}
        />
      </div>

      {/* Звук — одна группа (близость = принадлежность): иконка не отрывается
          от своей громкости, полный экран — отдельная команда с бо́льшим шагом. */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={UTILITY_BUTTON_CLASS}
          onClick={player.toggleMute}
          aria-label={player.muted ? ui.files.unmute : ui.files.mute}
          title={player.muted ? ui.files.unmute : ui.files.mute}
        >
          {player.muted ? <VolumeX /> : <Volume2 />}
        </Button>

        <div className={cn('hidden w-16 sm:block', TRACK_CLASS)}>
          <span aria-hidden className={FILL_CLASS} style={{ width: knobPosition(volume) }} />
          <span aria-hidden className={KNOB_CLASS} style={{ left: knobPosition(volume) }} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={player.muted ? 0 : player.volume}
            onChange={(event) => player.changeVolume(Number(event.target.value))}
            aria-label={ui.files.volume}
            className={RANGE_CLASS}
          />
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn('ml-1', UTILITY_BUTTON_CLASS)}
        onClick={player.toggleFullscreen}
        aria-label={player.fullscreen ? ui.files.exitFullscreen : ui.files.fullscreen}
        title={player.fullscreen ? ui.files.exitFullscreen : ui.files.fullscreen}
      >
        {player.fullscreen ? <Minimize2 /> : <Maximize2 />}
      </Button>
    </div>
  );
}
