// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { VideoPlayerView } from './video-player-view.js';

afterEach(cleanup);

/** #787: видео открывается «кинозалом» — тёмный экран, тонкая строка
 *  (имя/скачать/закрыть), плеер вписан по обеим осям. */
describe('VideoPlayerView — кинозал видео (#787)', () => {
  it('тёмный диалог во весь экран: нативные controls, оба потолка, имя и скачивание', () => {
    const { container } = render(
      <VideoPlayerView url="/files/roll.mp4" name="ролик.mp4" onClose={vi.fn()} />,
    );

    const dialog = screen.getByRole('dialog');
    // Портал: кинозал живёт в body поверх интерфейса (z-80), не в дереве хоста.
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('inset-0');
    expect(dialog.className).toContain('bg-black');

    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(video?.className).toContain('max-h-full');
    expect(video?.className).toContain('max-w-full');
    expect(video?.className).toContain('object-contain');
    expect(video?.getAttribute('aria-label')).toBe('ролик.mp4');

    expect(screen.getByText('ролик.mp4')).toBeTruthy();
    const download = screen.getByRole('link', { name: ui.files.download });
    expect(download.getAttribute('href')).toBe('/files/roll.mp4');
    expect(download.getAttribute('download')).toBe('ролик.mp4');
  });

  it('закрывает по кнопке и по заднику, но не по клику на плеер', () => {
    const onClose = vi.fn();
    render(<VideoPlayerView url="/files/roll.mp4" name="ролик.mp4" onClose={onClose} />);

    fireEvent.click(document.querySelector('video') as HTMLVideoElement);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: ui.files.close }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Задник — сам диалог (клик мимо плеера и шапки).
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
