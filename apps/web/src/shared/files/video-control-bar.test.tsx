// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { VideoPlayerView } from './video-player-view.js';

/**
 * Своя полоса управления кинозала (#1054): кнопки командуют нативным
 * `<video>`; полоса живёт поверх нижней кромки зала и прячется во время
 * игры (Telegram). Состояние полосы читается из событий элемента — здесь
 * они воспроизводятся руками, потому что jsdom не проигрывает медиа.
 */

let paused = true;
let ended = false;
let currentTime = 0;
let duration = 0;
let playSpy: ReturnType<typeof vi.spyOn>;
let pauseSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 0;
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused = false;
    ended = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused = true;
    this.dispatchEvent(new Event('pause'));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

/** Рендер зала с управляемым медиаэлементом (paused/duration/currentTime). */
function setup() {
  const onClose = vi.fn();
  render(<VideoPlayerView url="/files/roll.mp4" name="ролик.mp4" onClose={onClose} />);
  const video = document.querySelector('video') as HTMLVideoElement;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  Object.defineProperty(video, 'ended', { configurable: true, get: () => ended });
  Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
      // Как в браузере: перемотка до конца — конец, назад — ролик снова живой.
      ended = duration > 0 && value >= duration;
    },
  });
  return { video, onClose };
}

describe('VideoControlBar — полоса кинозала (#1054)', () => {
  it('пуск и пауза: кнопка меняет имя по состоянию кадра', () => {
    const { video } = setup();

    fireEvent.click(screen.getByRole('button', { name: ui.files.play }));
    expect(playSpy).toHaveBeenCalled();
    expect(paused).toBe(false);
    expect(screen.getByRole('button', { name: ui.files.pause })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.files.pause }));
    expect(pauseSpy).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: ui.files.play })).toBeTruthy();

    // Кадр сам сообщил о конце — кнопка предлагает повтор.
    ended = true;
    paused = true;
    act(() => {
      video.dispatchEvent(new Event('ended'));
    });
    expect(screen.getByRole('button', { name: ui.files.replay })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.files.replay }));
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(currentTime).toBe(0);
  });

  it('время и перемотка: текущее/остаток и ползунок с aria-valuetext', () => {
    const { video } = setup();

    duration = 9;
    act(() => {
      video.dispatchEvent(new Event('durationchange'));
    });
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByText('-0:09')).toBeTruthy();

    currentTime = 5;
    act(() => {
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(screen.getByText('0:05')).toBeTruthy();
    expect(screen.getByText('-0:04')).toBeTruthy();

    const seek = screen.getByRole('slider', { name: ui.files.seek });
    expect(seek.getAttribute('aria-valuetext')).toBe(`0:05 ${ui.files.timeOf} 0:09`);

    fireEvent.change(seek, { target: { value: '3' } });
    expect(currentTime).toBe(3);
  });

  it('перемотка назад после конца снимает «Воспроизвести заново»', () => {
    const { video } = setup();
    duration = 9;
    act(() => {
      video.dispatchEvent(new Event('durationchange'));
    });
    ended = true;
    paused = true;
    currentTime = 9;
    act(() => {
      video.dispatchEvent(new Event('ended'));
    });
    expect(screen.getByRole('button', { name: ui.files.replay })).toBeTruthy();

    fireEvent.change(screen.getByRole('slider', { name: ui.files.seek }), {
      target: { value: '3' },
    });
    expect(screen.getByRole('button', { name: ui.files.play })).toBeTruthy();
  });

  it('клавиши зала работают и без фокуса на кадре', () => {
    const { video } = setup();

    // Фокус на ползунке (после клика мышью): пробел — пуск/пауза, M — звук.
    const seek = screen.getByRole('slider', { name: ui.files.seek });
    fireEvent.keyDown(seek, { key: ' ' });
    expect(playSpy).toHaveBeenCalled();

    const mute = screen.getByRole('button', { name: ui.files.mute });
    fireEvent.keyDown(mute, { key: 'm', code: 'KeyM' });
    expect(video.muted).toBe(true);

    // Пробел на кнопке — её собственное нажатие: пуск не дублируется.
    playSpy.mockClear();
    fireEvent.keyDown(mute, { key: ' ' });
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('звук: выключение и включение', () => {
    const { video } = setup();

    fireEvent.click(screen.getByRole('button', { name: ui.files.mute }));
    expect(video.muted).toBe(true);
    act(() => {
      video.dispatchEvent(new Event('volumechange'));
    });
    expect(screen.getByRole('button', { name: ui.files.unmute })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.files.unmute }));
    expect(video.muted).toBe(false);
    act(() => {
      video.dispatchEvent(new Event('volumechange'));
    });
    expect(screen.getByRole('button', { name: ui.files.mute })).toBeTruthy();
  });

  it('открытое меню скорости держит панель на экране', () => {
    vi.useFakeTimers();
    const { video } = setup();
    const layer = screen.getByRole('toolbar', { name: ui.files.videoControls }).parentElement!;

    act(() => {
      video.dispatchEvent(new Event('play'));
    });
    fireEvent.click(screen.getByRole('button', { name: ui.files.playbackSpeed }));
    act(() => {
      vi.advanceTimersByTime(2600);
    });

    expect(layer.className).toContain('opacity-100');
  });

  it('скорость: шестерёнка открывает меню, пресет 1.5× меняет playbackRate', async () => {
    const { video } = setup();
    fireEvent.click(screen.getByRole('button', { name: ui.files.playbackSpeed }));

    const fast = await screen.findByRole('button', { name: /1\.5x/ });
    fireEvent.click(fast);
    expect(video.playbackRate).toBe(1.5);
    await waitFor(() => expect(screen.queryByRole('button', { name: /1\.5x/ })).toBeNull());
  });

  it('стрелки перематывают и после паузы кнопкой — фокус на кнопке, а не на кадре', () => {
    const { video } = setup();
    duration = 9;

    const play = screen.getByRole('button', { name: ui.files.play });
    play.focus();
    fireEvent.keyDown(play, { key: 'ArrowRight' });
    expect(currentTime).toBe(5);

    fireEvent.keyDown(play, { key: 'ArrowLeft' });
    expect(currentTime).toBe(0);
    expect(video.duration).toBe(9);
  });

  it('↑/↓ меняют громкость и после паузы кнопкой', () => {
    const { video } = setup();

    const play = screen.getByRole('button', { name: ui.files.play });
    play.focus();
    fireEvent.keyDown(play, { key: 'ArrowDown' });
    expect(video.volume).toBeCloseTo(0.95);

    fireEvent.keyDown(play, { key: 'ArrowUp' });
    expect(video.volume).toBeCloseTo(1);
  });

  it('клавиатура у кадра: пробел, M, ↑/↓ и стрелки ±5 с', () => {
    const { video } = setup();
    duration = 9;

    fireEvent.keyDown(video, { key: ' ' });
    expect(playSpy).toHaveBeenCalled();

    fireEvent.keyDown(video, { key: 'ArrowDown' });
    expect(video.volume).toBeCloseTo(0.95);
    fireEvent.keyDown(video, { key: 'ArrowUp' });
    expect(video.volume).toBeCloseTo(1);

    fireEvent.keyDown(video, { key: 'm', code: 'KeyM' });
    expect(video.muted).toBe(true);

    fireEvent.keyDown(video, { key: 'ArrowRight' });
    expect(currentTime).toBe(5);
    fireEvent.keyDown(video, { key: 'ArrowLeft' });
    expect(currentTime).toBe(0);
  });
});
