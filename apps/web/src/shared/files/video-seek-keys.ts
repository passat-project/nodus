import type { KeyboardEvent } from 'react';

/** Шаг перемотки стрелками — как в видеосервисах (YouTube/Bitrix), #1005. */
export const VIDEO_SEEK_STEP_SECONDS = 5;

/**
 * `←`/`→` нативного `<video>`: ±5 секунд.
 *
 * Chromium ведёт стрелки на внутренний таймлайн (range `step=any`), и шаг там —
 * 1% длительности (на коротком ролике доли секунды: «стрелки не перематывают»).
 * Своя обработка на хосте плеера перекрывает нативный шаг и даёт привычные
 * 5 секунд; событие из контролов всплывает на `<video>` (composed), поэтому
 * работает и при фокусе на полосе. Остальные клавиши (пробел, громкость) —
 * нативные, их не трогаем.
 */
export function handleVideoSeekKey(event: KeyboardEvent<HTMLVideoElement>): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const player = event.currentTarget;
  if (!Number.isFinite(player.duration)) return;
  event.preventDefault();
  const delta = event.key === 'ArrowRight' ? VIDEO_SEEK_STEP_SECONDS : -VIDEO_SEEK_STEP_SECONDS;
  player.currentTime = Math.min(Math.max(0, player.currentTime + delta), player.duration);
}
