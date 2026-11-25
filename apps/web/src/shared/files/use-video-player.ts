import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Состояние и команды своего плеера кинозала (#1054). Браузерная полоса
 * управления Chromium притемняет низ кадра градиентом, а настроить её
 * нельзя — внутренние псевдоэлементы (`docs/gotchas/frontend.md`), поэтому
 * кнопки свои, а `<video>` живёт без `controls`.
 *
 * Состояние не дублирует модель элемента: `play/pause/ended` приходят
 * событиями, команды пишут прямо в элемент. `src` — ключ источника: при
 * смене файла `<video>` перемонтируется (`key={url}`), подписки нужно
 * навесить на НОВЫЙ элемент, иначе полоса замирает на старом.
 */
export function useVideoPlayer({
  playerRef,
  containerRef,
  src,
}: {
  playerRef: RefObject<HTMLVideoElement | null>;
  /** Слой кинозала: его разворачиваем на весь экран (кадр остаётся с полосой). */
  containerRef: RefObject<HTMLElement | null>;
  src: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const el = playerRef.current;
    if (!el) return;

    const onTime = () => setTime(el.currentTime);
    const onDuration = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => {
      setPlaying(true);
      setEnded(false);
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setEnded(true);
    };
    const onVolume = () => {
      setMuted(el.muted || el.volume === 0);
      setVolume(el.volume);
    };

    // Первичный снимок: метаданные могли прийти до подписки (кэш браузера).
    onDuration();
    onVolume();
    setPlaying(!el.paused && !el.ended);

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('seeking', onTime);
    el.addEventListener('seeked', onTime);
    el.addEventListener('durationchange', onDuration);
    el.addEventListener('loadedmetadata', onDuration);
    el.addEventListener('play', onPlay);
    el.addEventListener('playing', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('volumechange', onVolume);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('seeking', onTime);
      el.removeEventListener('seeked', onTime);
      el.removeEventListener('durationchange', onDuration);
      el.removeEventListener('loadedmetadata', onDuration);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('playing', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('volumechange', onVolume);
    };
  }, [playerRef, src]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [containerRef]);

  const togglePlay = useCallback(() => {
    const el = playerRef.current;
    if (!el) return;
    if (!el.paused && !el.ended) {
      el.pause();
      return;
    }
    if (el.ended) el.currentTime = 0;
    void el.play().catch(() => undefined);
  }, [playerRef]);

  const seekTo = useCallback(
    (seconds: number) => {
      const el = playerRef.current;
      if (!el) return;
      const max = Number.isFinite(el.duration) ? el.duration : 0;
      el.currentTime = Math.min(Math.max(0, seconds), max);
      setTime(el.currentTime);
    },
    [playerRef],
  );

  const toggleMute = useCallback(() => {
    const el = playerRef.current;
    if (!el) return;
    el.muted = !el.muted;
    if (!el.muted && el.volume === 0) el.volume = 1;
  }, [playerRef]);

  const changeVolume = useCallback(
    (value: number) => {
      const el = playerRef.current;
      if (!el) return;
      el.volume = Math.min(1, Math.max(0, value));
      el.muted = el.volume === 0;
    },
    [playerRef],
  );

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void container.requestFullscreen().catch(() => undefined);
  }, [containerRef]);

  return {
    playing,
    ended,
    time,
    duration,
    muted,
    volume,
    fullscreen,
    togglePlay,
    seekTo,
    toggleMute,
    changeVolume,
    toggleFullscreen,
  };
}

export type VideoPlayer = ReturnType<typeof useVideoPlayer>;
