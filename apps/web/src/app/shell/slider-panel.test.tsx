// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { SliderPanel } from './slider-panel.js';

// Видимость полосы читает роутер — вне RouterProvider подменяем (не предмет теста).
vi.mock('./rail-visibility.js', () => ({ useRailHidden: () => false }));

/** Поддельная WAAPI-анимация: события отпускаются тестом вручную. */
interface FakeAnimation {
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
}

describe('SliderPanel: закрытие схлопыванием в источник', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function openWithSource() {
    const anims: FakeAnimation[] = [];
    // jsdom не реализует Element.animate.
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: () => {
        const anim: FakeAnimation = { onfinish: null, oncancel: null };
        anims.push(anim);
        return anim;
      },
    });
    const onClose = vi.fn();
    render(
      <SliderPanel
        title="Карточка"
        onClose={onClose}
        sourceRect={{ x: 0, y: 0, width: 10, height: 10 }}
      >
        <div />
      </SliderPanel>,
    );
    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    return { anims, onClose };
  }

  it('отменённая анимация (oncancel) тоже закрывает панель — не зависает в closing', () => {
    const { anims, onClose } = openWithSource();
    expect(anims).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    act(() => anims[0]?.oncancel?.());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('закрытие однократно: finish, затем cancel доигравшей — onClose один раз', () => {
    const { anims, onClose } = openWithSource();
    act(() => anims[0]?.onfinish?.());
    act(() => anims[0]?.oncancel?.());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('после раскрытия промоушен снимается — слой перерисовывается в 1:1 (#969)', () => {
    render(
      <SliderPanel
        title="Карточка"
        onClose={vi.fn()}
        sourceRect={{ x: 0, y: 0, width: 10, height: 10 }}
      >
        <div />
      </SliderPanel>,
    );
    const section = screen.getByRole('dialog');
    expect(section.style.willChange).toBe('transform');

    // Чужие анимации (content-fade зон) промоушен не снимают: событие
    // приходит с дочернего элемента, а не с самой панели.
    const header = section.querySelector('header');
    fireEvent.animationEnd(header ?? section);
    expect(section.style.willChange).toBe('transform');

    fireEvent.animationEnd(section);
    expect(section.style.willChange).toBe('');
  });

  it('открытие без источника — постоянного промоушена нет (#969)', () => {
    render(
      <SliderPanel title="Карточка" onClose={vi.fn()}>
        <div />
      </SliderPanel>,
    );
    expect(screen.getByRole('dialog').style.willChange).toBe('');
  });

  it('закрытие промоутирует слой перед WAAPI и снимает его после (#969)', () => {
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: () => ({ onfinish: null, oncancel: null }),
    });
    render(
      <SliderPanel
        title="Карточка"
        onClose={vi.fn()}
        sourceRect={{ x: 0, y: 0, width: 10, height: 10 }}
      >
        <div />
      </SliderPanel>,
    );
    const section = screen.getByRole('dialog');

    // Раскрытие осело — промоушена больше нет.
    fireEvent.animationEnd(section);
    expect(section.style.willChange).toBe('');

    // Клик «Закрыть»: на время WAAPI-схлопывания слой снова промоутирован.
    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(section.style.willChange).toBe('transform');
  });

  it('закрытие в первые 430 мс не снимает промоушен: animationend раскрытия при closing игнорируется (#969)', () => {
    // openWithSource кликает «Закрыть» сразу после маунта — окно «закрытие
    // во время раскрытия», в котором animationend раскрытия ещё придёт.
    const { anims } = openWithSource();
    const section = screen.getByRole('dialog');
    expect(section.style.willChange).toBe('transform');

    fireEvent.animationEnd(section);
    // Промоушен нужен WAAPI-схлопыванию — событие раскрытия его не снимает.
    expect(section.style.willChange).toBe('transform');

    act(() => anims[0]?.onfinish?.());
    expect(section.style.willChange).toBe('');
  });
});
