// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { MediaViewer } from './media-viewer.js';

/** Классы сцены (первый потомок) — носитель ограничения высоты (#767). */
const stageOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;

const classesOf = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

/**
 * #767: видео в просмотрщике вылезало за низ панели, полоса управления
 * обрезалась. jsdom не считает раскладку, поэтому тест держит СТРУКТУРУ
 * ограничения: сцена — flex (у неё высота определена, процентный
 * `max-h-full` разрешается), у медиа — оба потолка и `object-contain`.
 * Живой замер (реальные высоты) — приёмка владельца в песочнице.
 */
describe('MediaViewer: медиа вписывается в панель по высоте (#767)', () => {
  it('видео: flex-сцена с min-h-0 и оба потолка у элемента', () => {
    const { container } = render(
      <MediaViewer url="/files/roll.mp4" mime="video/mp4" name="ролик.mp4" />,
    );
    const stage = stageOf(container);
    const stageClasses = classesOf(stage);
    // grid + place-items-center = auto-строка, процент против неё не считается.
    expect(stageClasses).toContain('flex');
    expect(stageClasses).not.toContain('grid');
    expect(stageClasses).toContain('min-h-0');
    expect(stageClasses).toContain('size-full');

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(classesOf(video)).toContain('max-h-full');
    expect(classesOf(video)).toContain('max-w-full');
    expect(classesOf(video)).toContain('object-contain');
    // Нативная полоса управления — то, что раньше уезжало под клип панели.
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(video?.getAttribute('aria-label')).toBe('ролик.mp4');
  });

  it('портретный ролик идёт тем же путём ограничения по высоте', () => {
    const { container } = render(
      <MediaViewer url="/files/tall.webm" mime="video/webm" name="вертикальный.webm" />,
    );
    expect(classesOf(stageOf(container))).toContain('flex');
    expect(classesOf(container.querySelector('video'))).toContain('max-h-full');
  });

  it('картинка без fit:width — та же сцена и те же потолки', () => {
    const { container } = render(
      <MediaViewer url="/files/scan.png" mime="image/png" name="скан.png" />,
    );
    expect(classesOf(stageOf(container))).toContain('flex');
    const img = container.querySelector('img');
    expect(classesOf(img)).toContain('max-h-full');
    expect(classesOf(img)).toContain('max-w-full');
    expect(classesOf(img)).toContain('object-contain');
  });

  it('картинка fit:width (скан письма) сохраняет прокрутку по ширине, без потолка высоты', () => {
    const { container } = render(
      <MediaViewer url="/files/scan.pdf.png" mime="image/png" name="скан.png" fit="width" />,
    );
    const scroller = stageOf(container);
    expect(classesOf(scroller)).toContain('overflow-auto');
    expect(classesOf(scroller)).not.toContain('flex');
    const img = container.querySelector('img');
    expect(classesOf(img)).toContain('w-full');
    expect(classesOf(img)).toContain('h-auto');
    expect(classesOf(img)).not.toContain('max-h-full');
  });

  it('аудио не задето: своя колонка max-w-md в той же сцене', () => {
    const { container } = render(
      <MediaViewer url="/files/voice.ogg" mime="audio/ogg" name="голос.ogg" />,
    );
    expect(classesOf(stageOf(container))).toContain('flex');
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(audio?.hasAttribute('controls')).toBe(true);
    expect(classesOf(audio?.parentElement ?? null)).toContain('max-w-md');
  });
});
