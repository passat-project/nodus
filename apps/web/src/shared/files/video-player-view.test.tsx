// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { VideoPlayerView } from './video-player-view.js';

beforeEach(() => {
  // jsdom не умеет воспроизведение: стабы, иначе клик по кадру сыплет ошибкой.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

/** #787: видео открывается «кинозалом» — тёмный экран, тонкая строка
 *  (имя/скачать/закрыть), плеер вписан по обеим осям. */
describe('VideoPlayerView — кинозал видео (#787)', () => {
  it('тёмный диалог во весь экран: кадр без браузерных кнопок, оба потолка, имя и скачивание', () => {
    const { container } = render(
      <VideoPlayerView url="/files/roll.mp4" name="ролик.mp4" onClose={vi.fn()} />,
    );

    const dialog = screen.getByRole('dialog');
    // Портал: кинозал живёт в body поверх интерфейса (z-80), не в дереве хоста.
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('inset-0');
    // Фон — полупрозрачное затемнение всего экрана (#790), без светлой полосы.
    expect(dialog.className).toContain('bg-neutral-900/80');

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    // #1054: браузерных кнопок НЕТ — их полоса притемняла низ кадра.
    expect(video?.hasAttribute('controls')).toBe(false);
    // Владелец 25.11.2026: ролик в кинозале стартует сразу при открытии.
    expect(video?.hasAttribute('autoplay')).toBe(true);
    expect(video?.getAttribute('preload')).toBe('auto');
    // #1005: фокус на плеере при открытии — иначе ←/→ уходят в интерфейс.
    expect(video?.tabIndex).toBe(0);
    expect(document.activeElement).toBe(video);
    expect(video?.className).toContain('min-h-0');
    expect(video?.className).toContain('max-h-full');
    expect(video?.className).toContain('max-w-full');
    expect(video?.className).toContain('object-contain');
    expect(video?.getAttribute('aria-label')).toBe('ролик.mp4');

    expect(screen.getByText('ролик.mp4')).toBeTruthy();
    const download = screen.getByRole('link', { name: ui.files.download });
    expect(download.getAttribute('href')).toBe('/files/roll.mp4');
    expect(download.getAttribute('download')).toBe('ролик.mp4');
    // Закрытие — плашка нашего скругления с обводкой, а не голый ghost-крестик
    // впритык к кнопкам окна (замечание владельца 24.11.2026).
    const close = screen.getByRole('button', { name: ui.files.close });
    expect(close.className).toContain('size-9');
    expect(close.className).toContain('border-white/15');
    expect(close.className).not.toContain('rounded-full');
  });

  it('кнопки полного экрана нет — зал и так раскрыт на всё окно', () => {
    render(<VideoPlayerView url="/files/roll.mp4" name="ролик.mp4" onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: ui.files.fullscreen })).toBeNull();
  });

  it('панель — сразу под кадром, по центру, а не на кромке экрана', () => {
    render(<VideoPlayerView url="/files/roll.mp4" name="ролик.mp4" onClose={vi.fn()} />);

    const video = document.querySelector('video')!;
    const bar = screen.getByRole('toolbar', { name: ui.files.videoControls });
    const barLayer = bar.parentElement!;
    // Кадр и панель — один блок: панель сразу под кадром, по центру.
    expect(bar.contains(video)).toBe(false);
    expect(video.nextElementSibling).toBe(barLayer);
    expect(barLayer.className).toContain('justify-center');
    expect(bar.className).toContain('rounded-xl');
    expect(bar.className).toContain('bg-neutral-700/95');
    expect(bar.className).toContain('max-w-[24rem]');
  });

  it('Telegram: полоса прячется через 2,5 с игры, возвращается на движение/паузу/конец', () => {
    vi.useFakeTimers();
    render(<VideoPlayerView url="/files/roll.mp4" name="ролик.mp4" onClose={vi.fn()} />);

    const video = document.querySelector('video')!;
    const barLayer = screen.getByRole('toolbar', { name: ui.files.videoControls }).parentElement!;
    expect(barLayer.className).toContain('opacity-100');

    act(() => {
      video.dispatchEvent(new Event('play'));
    });
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(barLayer.className).toContain('opacity-0');
    expect(barLayer.className).toContain('pointer-events-none');

    act(() => {
      fireEvent.mouseMove(screen.getByRole('dialog'));
    });
    expect(barLayer.className).toContain('opacity-100');

    // Пауза и конец — команды должны быть на виду.
    act(() => {
      video.dispatchEvent(new Event('pause'));
    });
    expect(barLayer.className).toContain('opacity-100');

    act(() => {
      video.dispatchEvent(new Event('play'));
    });
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(barLayer.className).toContain('opacity-0');
    act(() => {
      video.dispatchEvent(new Event('ended'));
    });
    expect(barLayer.className).toContain('opacity-100');
  });

  it('ошибка воспроизведения — табличка со скачиванием вместо кадра, без полосы', () => {
    render(<VideoPlayerView url="/files/roll.mp4" name="ролик.mp4" onClose={vi.fn()} />);

    fireEvent.error(document.querySelector('video') as HTMLVideoElement);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(ui.chat.videoUnsupported);
    const download = alert.querySelector('a');
    expect(download?.getAttribute('href')).toBe('/files/roll.mp4');
    expect(download?.hasAttribute('download')).toBe(true);
    expect(screen.queryByRole('toolbar')).toBeNull();
    // Крестик остаётся: из таблички всегда можно выйти.
    expect(screen.getByRole('button', { name: ui.files.close })).toBeTruthy();
    expect(document.activeElement).toBe(download);
  });

  it('закрывает по кнопке и по заднику, но не по клику на плеер', () => {
    const onClose = vi.fn();
    render(<VideoPlayerView url="/files/roll.mp4" name="ролик.mp4" onClose={onClose} />);

    // Клик по кадру — пуск/пауза, зал не закрывается.
    fireEvent.click(document.querySelector('video') as HTMLVideoElement);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: ui.files.close }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Задник — сам диалог (клик мимо плеера и полосы).
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
