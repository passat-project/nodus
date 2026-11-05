// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerClipMenu } from './composer-clip-menu.js';

/**
 * Скрепка композера (#620): попап открывается НАВЕДЕНИЕМ без зажатой кнопки
 * мыши и фокусом с клавиатуры; drag-выделение текста (mouseenter с buttons=1)
 * панель не открывает. Клик по скрепке — сразу проводник «Все файлы».
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const islandRef = { current: null };
  render(<ComposerClipMenu draftKey="test-draft" islandRef={islandRef} align="self-end" />);
  const clip = screen.getByRole('button', { name: 'Прикрепить файл' });
  return { clip };
}

describe('ComposerClipMenu — попап не открывается при выделении текста (#620)', () => {
  it('наведение с зажатой кнопкой мыши не открывает меню', () => {
    const { clip } = setup();
    fireEvent.mouseEnter(clip, { buttons: 1 });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('обычное наведение открывает меню', async () => {
    const { clip } = setup();
    fireEvent.mouseEnter(clip, { buttons: 0 });
    expect(await screen.findByRole('menu')).not.toBeNull();
  });

  it('после drag-наведения и отпускания меню не открывается до повторного наведения', async () => {
    const { clip } = setup();
    fireEvent.mouseEnter(clip, { buttons: 1 });
    fireEvent.mouseUp(clip);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.mouseLeave(clip);
    fireEvent.mouseEnter(clip, { buttons: 0 });
    expect(await screen.findByRole('menu')).not.toBeNull();
  });

  it('фокус с клавиатуры открывает меню', async () => {
    const { clip } = setup();
    fireEvent.focus(clip);
    expect(await screen.findByRole('menu')).not.toBeNull();
  });

  it('клик по скрепке по-прежнему открывает выбор файла', () => {
    const { clip } = setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(clip);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
