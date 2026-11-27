// @vitest-environment jsdom
import { StrictMode, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { SliderPanel, type SliderPanelHandle } from './slider-panel.js';

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

  it('корень помечается data-slider-open, пока жива хоть одна карточка (#948)', () => {
    // Признак читает globals.css (полосы таблиц за карточкой). Раньше это был
    // `html:has(section.slider-shadow)` — а `:has()` на корне ставил движок в
    // режим полной инвалидации стилей: ввод в мессенджере после раздела с
    // карточкой пересчитывал стили всего документа (gotchas frontend.md).
    const root = document.documentElement;
    expect(root.dataset.sliderOpen).toBeUndefined();

    const first = render(
      <SliderPanel title="Первая" onClose={vi.fn()}>
        <div />
      </SliderPanel>,
    );
    expect(root.dataset.sliderOpen).toBe('');

    // Стек карточек (ADR-0009): вторая поверх первой — флаг не снимается.
    const second = render(
      <SliderPanel title="Вторая" onClose={vi.fn()}>
        <div />
      </SliderPanel>,
    );
    first.unmount();
    expect(root.dataset.sliderOpen).toBe('');

    second.unmount();
    expect(root.dataset.sliderOpen).toBeUndefined();
    expect(root.dataset.sliderCount).toBeUndefined();
  });

  it('в режиме строгой проверки React счётчик симметричен маунту и размонтированию (#1017)', () => {
    // StrictMode дважды запускает эффект (маунт → очистка → маунт). Если
    // очистка и установка несимметричны, после первого размонтирования
    // признак #948 «залипнет» на корне навсегда.
    const root = document.documentElement;
    expect(root.dataset.sliderOpen).toBeUndefined();

    const panel = render(
      <StrictMode>
        <SliderPanel title="Строгая" onClose={vi.fn()}>
          <div />
        </SliderPanel>
      </StrictMode>,
    );
    expect(root.dataset.sliderOpen).toBe('');
    expect(root.dataset.sliderCount).toBe('1');

    panel.unmount();
    expect(root.dataset.sliderOpen).toBeUndefined();
    expect(root.dataset.sliderCount).toBeUndefined();
  });
});

/** Гейт Esc-слоёв (#1021): открытый поповер (реальное содержимое обёртки с
 *  data-state=open, не тултип) съедает Esc; обёртка в exit-анимации
 *  (data-state=closed) и тултип — не мешают панели закрыться. */
describe('SliderPanel: Esc и popper-слои (#1021)', () => {
  afterEach(() => {
    cleanup();
    document.querySelectorAll('[data-radix-popper-content-wrapper]').forEach((el) => el.remove());
  });

  function appendWrapper(content: string): void {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-radix-popper-content-wrapper', '');
    wrapper.innerHTML = content;
    document.body.append(wrapper);
  }

  it('Esc закрывает панель без источника (прямое onClose)', () => {
    const onClose = vi.fn();
    render(
      <SliderPanel title="Карточка" onClose={onClose}>
        <div />
      </SliderPanel>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('открытый поповер (data-state=open) съедает Esc — панель остаётся', () => {
    const onClose = vi.fn();
    render(
      <SliderPanel title="Карточка" onClose={onClose}>
        <div />
      </SliderPanel>,
    );
    appendWrapper('<div data-state="open" role="menu">меню</div>');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('обёртка в exit-анимации (data-state=closed) и открытый тултип Esc не глотают', () => {
    const onClose = vi.fn();
    render(
      <SliderPanel title="Карточка" onClose={onClose}>
        <div />
      </SliderPanel>,
    );
    appendWrapper('<div data-state="closed" role="menu">закрывается</div>');
    appendWrapper('<div data-state="open" role="tooltip">подсказка</div>');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/** Страж закрытия (#857): карточка с несохранёнными правками спрашивает
 *  «Уйти?» ДО схлопывания — иначе после «Отмена» панель зависала бы закрытой,
 *  но в стеке. Согласившись, владелец зовёт `close()` панели тем же путём. */
describe('SliderPanel: страж закрытия и close() (#857)', () => {
  afterEach(cleanup);

  function Panel({ onClose, closeGuard }: { onClose: () => void; closeGuard: () => boolean }) {
    const ref = useRef<SliderPanelHandle>(null);
    return (
      <>
        <SliderPanel title="Карточка" onClose={onClose} closeGuard={closeGuard} ref={ref}>
          <button type="button" onClick={() => ref.current?.close()}>
            leave
          </button>
        </SliderPanel>
      </>
    );
  }

  it('страж вернул false — Esc не закрывает: панель не в режиме закрытия, onClose не зван', () => {
    const onClose = vi.fn();
    const closeGuard = vi.fn(() => false);
    render(<Panel onClose={onClose} closeGuard={closeGuard} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeGuard).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    // Панель не «залипла»: повторный Esc снова спрашивает стража.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeGuard).toHaveBeenCalledTimes(2);
  });

  it('после согласия close() закрывает панель тем же путём, что Esc', async () => {
    const onClose = vi.fn();
    let allowed = false;
    render(<Panel onClose={onClose} closeGuard={() => allowed} />);
    // Контент панели монтируется после первого кадра (double rAF).
    const leave = await screen.findByRole('button', { name: 'leave' });
    fireEvent.click(leave);
    expect(onClose).not.toHaveBeenCalled();
    allowed = true;
    fireEvent.click(leave);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('без стража поведение прежнее: X закрывает', () => {
    const onClose = vi.fn();
    render(
      <SliderPanel title="Карточка" onClose={onClose}>
        <div />
      </SliderPanel>,
    );
    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
