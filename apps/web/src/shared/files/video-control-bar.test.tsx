// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { VideoPlayerView } from './video-player-view.js';

/**
 * Своя полоса управления кинозала (#1054): кнопки ПОД кадром командуют
 * нативным `<video>`; поверх кадра не появляется ничего. Состояние полосы
 * читается из событий элемента — здесь они воспроизводятся руками, потому
 * что jsdom не проигрывает медиа.
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
  vi.restoreAllMocks();
  cleanup();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
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
    },
  });
  return { video, onClose };
}

describe('VideoControlBar — своя полоса под кадром (#1054)', () => {
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

  it('время и перемотка: «0:05 / 0:09» и ползунок с aria-valuetext', () => {
    const { video } = setup();

    duration = 9;
    act(() => {
      video.dispatchEvent(new Event('durationchange'));
    });
    expect(screen.getByText('0:00 / 0:09')).toBeTruthy();

    currentTime = 5;
    act(() => {
      video.dispatchEvent(new Event('timeupdate'));
    });
    expect(screen.getByText('0:05 / 0:09')).toBeTruthy();

    const seek = screen.getByRole('slider', { name: ui.files.seek });
    expect(seek.getAttribute('aria-valuetext')).toBe(`0:05 ${ui.files.timeOf} 0:09`);

    fireEvent.change(seek, { target: { value: '3' } });
    expect(currentTime).toBe(3);
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

  it('весь экран: разворачивается слой зала, кнопка ведёт обратно', () => {
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: request,
    });
    const exit = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });

    setup();
    fireEvent.click(screen.getByRole('button', { name: ui.files.fullscreen }));
    expect(request).toHaveBeenCalled();

    // Браузер вошёл в полный экран: событие + состояние документа.
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => screen.getByRole('dialog'),
    });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(screen.getByRole('button', { name: ui.files.exitFullscreen })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.files.exitFullscreen }));
    expect(exit).toHaveBeenCalled();
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  });

  it('клавиатура у кадра: пробел, M, F и стрелки ±5 с', () => {
    const { video } = setup();
    duration = 9;
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: request,
    });

    fireEvent.keyDown(video, { key: ' ' });
    expect(playSpy).toHaveBeenCalled();

    fireEvent.keyDown(video, { key: 'm', code: 'KeyM' });
    expect(video.muted).toBe(true);

    fireEvent.keyDown(video, { key: 'f', code: 'KeyF' });
    expect(request).toHaveBeenCalled();

    fireEvent.keyDown(video, { key: 'ArrowRight' });
    expect(currentTime).toBe(5);
    fireEvent.keyDown(video, { key: 'ArrowLeft' });
    expect(currentTime).toBe(0);

    // Модификаторы не перехватываем: Ctrl+F — поиск браузера, не полный экран.
    request.mockClear();
    fireEvent.keyDown(video, { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(request).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  });
});
