import type { KeyboardEvent } from 'react';

/** Шаг перемотки стрелками — как в видеосервисах (YouTube/Bitrix), #1005. */
export const VIDEO_SEEK_STEP_SECONDS = 5;

/**
 * `←`/`→` — ±5 секунд на элементе `<video>` (общая логика для кадра зала и
 * обработчика всего слоя: после клика по кнопке панели фокус уходит с кадра,
 * а стрелки должны продолжать перематывать).
 *
 * Chromium ведёт стрелки на внутренний таймлайн (range `step=any`), и шаг там —
 * 1% длительности (на коротком ролике доли секунды: «стрелки не перематывают»).
 * Своя обработка на хосте плеера перекрывает нативный шаг и даёт привычные
 * 5 секунд; событие из контролов всплывает на `<video>` (composed), поэтому
 * работает и при фокусе на полосе. Пробел и громкость у ролика с нативными
 * кнопками — нативные, их не трогаем; у кинозала (#1054) браузерных кнопок
 * нет, и пробел/M обрабатывает сам зал (`video-player-view.tsx`).
 */
export function seekVideoByKey(player: HTMLVideoElement, key: string): boolean {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
  if (!Number.isFinite(player.duration)) return false;
  const delta = key === 'ArrowRight' ? VIDEO_SEEK_STEP_SECONDS : -VIDEO_SEEK_STEP_SECONDS;
  player.currentTime = Math.min(Math.max(0, player.currentTime + delta), player.duration);
  return true;
}

export function handleVideoSeekKey(event: KeyboardEvent<HTMLVideoElement>): void {
  if (seekVideoByKey(event.currentTarget, event.key)) event.preventDefault();
}
