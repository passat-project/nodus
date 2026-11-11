// @vitest-environment jsdom

import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Harness,
  down,
  dispatchWindowPointer,
  flushFrame,
  installFrameControl,
  render,
  screen,
} from './use-card-tab-drag.test-helpers.js';

installFrameControl();
afterEach(cleanup);

describe('useCardTabDrag: отмена, слушатели и авто-прокрутка', () => {
  it('Escape отменяет перетаскивание без применения', () => {
    const onResolve = vi.fn();
    render(<Harness onResolve={onResolve} />);
    down();
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 500, clientY: 300 });
    flushFrame();
    expect(screen.getByTestId('marker').textContent).not.toBe('');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByTestId('visual').textContent).toBe('');
    expect(screen.getByTestId('marker').textContent).toBe('');
    expect(screen.getByTestId('dragging').textContent).toBe('no');
  });

  it('pointercancel и потеря capture отменяют без применения', () => {
    const onResolve = vi.fn();
    render(<Harness onResolve={onResolve} />);
    const tab = screen.getByTestId('tab-a');
    fireEvent.pointerDown(tab, { pointerId: 7, button: 0, clientX: 50, clientY: 20 });
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 500, clientY: 300 });
    flushFrame();
    dispatchWindowPointer('pointercancel', { pointerId: 7 });
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByTestId('dragging').textContent).toBe('no');

    fireEvent.pointerDown(tab, { pointerId: 8, button: 0, clientX: 50, clientY: 20 });
    dispatchWindowPointer('pointermove', { pointerId: 8, clientX: 500, clientY: 300 });
    flushFrame();
    act(() => {
      tab.dispatchEvent(new Event('lostpointercapture', { bubbles: true }));
    });
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByTestId('visual').textContent).toBe('');
  });

  it('чужие pointerId не влияют на drag', () => {
    const onResolve = vi.fn();
    render(<Harness onResolve={onResolve} />);
    down();
    dispatchWindowPointer('pointermove', { pointerId: 99, clientX: 500, clientY: 300 });
    dispatchWindowPointer('pointerup', { pointerId: 99 });
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByTestId('dragging').textContent).toBe('no');
  });

  it('вторичная кнопка мыши и [data-no-tab-drag] не запускают drag', () => {
    const onResolve = vi.fn();
    render(<Harness onResolve={onResolve} noDragTarget />);
    down({ button: 2 });
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 500, clientY: 300 });
    dispatchWindowPointer('pointerup', { pointerId: 7, clientX: 500, clientY: 300 });
    expect(onResolve).not.toHaveBeenCalled();

    down({ testId: 'inner', pointerId: 9 });
    dispatchWindowPointer('pointermove', { pointerId: 9, clientX: 500, clientY: 300 });
    dispatchWindowPointer('pointerup', { pointerId: 9, clientX: 500, clientY: 300 });
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('cancel() до старта снимает слушатели, после старта — сбрасывает визуал', () => {
    const onResolve = vi.fn();
    render(<Harness onResolve={onResolve} />);
    const tab = screen.getByTestId('tab-a');
    fireEvent.pointerDown(tab, { pointerId: 7, button: 0, clientX: 50, clientY: 20 });
    fireEvent.click(screen.getByTestId('cancel'));
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 500, clientY: 300 });
    dispatchWindowPointer('pointerup', { pointerId: 7, clientX: 500, clientY: 300 });
    expect(onResolve).not.toHaveBeenCalled();

    fireEvent.pointerDown(tab, { pointerId: 8, button: 0, clientX: 50, clientY: 20 });
    dispatchWindowPointer('pointermove', { pointerId: 8, clientX: 500, clientY: 300 });
    flushFrame();
    expect(screen.getByTestId('visual').textContent).not.toBe('');
    fireEvent.click(screen.getByTestId('cancel'));
    expect(screen.getByTestId('visual').textContent).toBe('');
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('авто-прокрутка полосы у края сдвигает scrollLeft', () => {
    const onResolve = vi.fn();
    const strip = document.createElement('div');
    Object.defineProperty(strip, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(strip, 'clientWidth', { value: 100, configurable: true });
    strip.scrollLeft = 30;
    const strips = [{ el: strip, rect: { left: 0, top: 0, right: 800, bottom: 40 } }];
    render(<Harness onResolve={onResolve} strips={strips} />);
    down();
    // Активация у левого края полосы → первый кадр auto-scroll сдвигает на 14.
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 10, clientY: 20 });
    flushFrame();
    expect(strip.scrollLeft).toBe(16);

    // У правого края — прокрутка к максимуму с ограничением.
    strip.scrollLeft = 380;
    dispatchWindowPointer('pointermove', { pointerId: 7, clientX: 795, clientY: 20 });
    flushFrame();
    expect(strip.scrollLeft).toBe(394);
  });
});
