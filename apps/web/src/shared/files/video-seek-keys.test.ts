import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent } from 'react';

import { handleVideoSeekKey, VIDEO_SEEK_STEP_SECONDS } from './video-seek-keys.js';

/**
 * #1005: нативный шаг стрелок Chromium — 1% длительности; наш хост даёт
 * привычные ±5 секунд и клампит по границам ролика.
 */
function key(
  currentTime: number,
  duration: number,
  keyName: string,
): { event: KeyboardEvent<HTMLVideoElement>; preventDefault: ReturnType<typeof vi.fn> } {
  const player = { currentTime, duration } as HTMLVideoElement;
  const preventDefault = vi.fn();
  return {
    event: {
      key: keyName,
      currentTarget: player,
      preventDefault,
    } as unknown as KeyboardEvent<HTMLVideoElement>,
    preventDefault,
  };
}

describe('handleVideoSeekKey — стрелки плеера ±5 секунд', () => {
  it('вправо — +5 с', () => {
    const { event, preventDefault } = key(10, 60, 'ArrowRight');
    handleVideoSeekKey(event);
    expect(event.currentTarget.currentTime).toBe(10 + VIDEO_SEEK_STEP_SECONDS);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('влево — −5 с с клампом на ноль', () => {
    const { event } = key(2, 60, 'ArrowLeft');
    handleVideoSeekKey(event);
    expect(event.currentTarget.currentTime).toBe(0);
  });

  it('вправо клампится временем ролика', () => {
    const { event } = key(58, 60, 'ArrowRight');
    handleVideoSeekKey(event);
    expect(event.currentTarget.currentTime).toBe(60);
  });

  it('другие клавиши не перехватываются', () => {
    const { event, preventDefault } = key(10, 60, 'Space');
    const before = event.currentTarget.currentTime;
    handleVideoSeekKey(event);
    expect(event.currentTarget.currentTime).toBe(before);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('пока длительность неизвестна — нативному поведению не мешаем', () => {
    const { event, preventDefault } = key(0, Number.NaN, 'ArrowRight');
    handleVideoSeekKey(event);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
