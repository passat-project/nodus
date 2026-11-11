// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { MediaViewer } from './media-viewer.js';

/**
 * #767: сцена медиа — flex, а не grid. У ребёнка auto-строки грида
 * процентный max-height циклический и высоту не ограничивает (jsdom
 * раскладку не считает, поэтому регресс держим структурой: flex-сцена +
 * оба max-ограничения у медиа; живой замер — Playwright/руками).
 */
describe('MediaViewer: медиа ужимается по обеим осям (#767)', () => {
  it('видео: flex-сцена с центрированием и max-h-full/max-w-full', () => {
    const { container } = render(
      <MediaViewer url="/files/clip.mp4" mime="video/mp4" name="clip.mp4" />,
    );
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    const stage = video!.parentElement!;
    expect(stage.className).toContain('flex');
    expect(stage.className).toContain('items-center');
    expect(stage.className).toContain('justify-center');
    expect(stage.className).not.toContain('grid');
    expect(video!.className).toContain('max-h-full');
    expect(video!.className).toContain('max-w-full');
  });

  it('картинка в нативном масштабе: та же flex-сцена', () => {
    const { container } = render(
      <MediaViewer url="/files/photo.jpg" mime="image/jpeg" name="photo.jpg" />,
    );
    const img = container.querySelector('img');
    const stage = img!.parentElement!;
    expect(stage.className).toContain('flex');
    expect(stage.className).not.toContain('grid');
    expect(img!.className).toContain('max-h-full');
    expect(img!.className).toContain('max-w-full');
  });

  it('картинка fit=width (вкладки/письма) не переведена на сцену — по ширине со скроллом', () => {
    const { container } = render(
      <MediaViewer url="/files/scan.jpg" mime="image/jpeg" name="scan.jpg" fit="width" />,
    );
    const img = container.querySelector('img')!;
    expect(img.className).toContain('w-full');
    expect(img.parentElement!.className).toContain('overflow-auto');
  });

  it('аудио-ветка не затронута: колонка max-w-md, аудио на всю ширину', () => {
    const { container } = render(
      <MediaViewer url="/files/voice.m4a" mime="audio/mp4" name="voice.m4a" />,
    );
    const audio = container.querySelector('audio')!;
    expect(audio.className).toContain('w-full');
    expect(audio.parentElement!.className).toContain('max-w-md');
  });
});
