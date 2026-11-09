// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePointerDrag } from './use-pointer-drag.js';

/** Перетаскивание элемента окна (#496, Р2): порог клика, место вставки,
 *  коммит по отпусканию и отмена Esc/pointercancel. */

function box(top: number, left: number, width: number, height = 40) {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setup() {
  const container = document.createElement('div');
  const first = document.createElement('div');
  first.dataset.builderIndex = '0';
  first.getBoundingClientRect = () => box(0, 0, 400);
  const second = document.createElement('div');
  second.dataset.builderIndex = '1';
  second.dataset.builderPaired = 'true';
  second.getBoundingClientRect = () => box(60, 0, 190);
  container.append(first, second);
  container.getBoundingClientRect = () => box(0, 0, 400, 120);
  document.body.append(container);
  const ref = { current: container } as RefObject<HTMLElement | null>;
  const onDrop = vi.fn();
  const hook = renderHook(() => usePointerDrag(ref, onDrop));
  return { container, ref, onDrop, hook };
}

function pointer(type: 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number) {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }));
}

function begin(hook: ReturnType<typeof setup>['hook'], x: number, y: number, button = 0) {
  act(() => {
    hook.result.current.begin(
      {
        button,
        clientX: x,
        clientY: y,
        preventDefault: vi.fn(),
      } as unknown as ReactPointerEvent<HTMLElement>,
      0,
    );
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('usePointerDrag: жест перетаскивания', () => {
  it('правая кнопка и отсутствие контейнера — не начинают жест', () => {
    const { hook, onDrop } = setup();
    begin(hook, 10, 10, 2);
    act(() => pointer('pointermove', 200, 200));
    expect(hook.result.current.drag).toBeNull();

    const empty = renderHook(() => usePointerDrag({ current: null }, onDrop));
    act(() => {
      empty.result.current.begin(
        { button: 0, clientX: 0, clientY: 0, preventDefault: vi.fn() } as never,
        0,
      );
    });
    expect(empty.result.current.drag).toBeNull();
  });

  it('сдвиг меньше 6px — клик, а не перенос; больше — линия места и индекс', () => {
    const { hook, onDrop } = setup();
    begin(hook, 10, 10);

    act(() => pointer('pointermove', 12, 13));
    expect(hook.result.current.drag).toBeNull();

    // Указатель ниже середины второй строки — вставка в конец.
    act(() => pointer('pointermove', 100, 90));
    expect(hook.result.current.drag).toEqual({
      from: 0,
      before: 2,
      indicator: { left: 0, top: 105, width: 400, height: 2 },
    });

    act(() => pointer('pointerup', 100, 90));
    expect(onDrop).toHaveBeenCalledWith(0, 2);
    expect(hook.result.current.drag).toBeNull();
  });

  it('пара половин: линия вертикальная; попадание в первую — перед ней', () => {
    const { hook } = setup();
    begin(hook, 10, 10);

    act(() => pointer('pointermove', 40, 70));
    expect(hook.result.current.drag).toEqual({
      from: 0,
      before: 1,
      indicator: { left: -7, top: 60, width: 2, height: 40 },
    });
  });

  it('пустой контейнер — индикатора нет, коммит всё равно сообщает 0', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => box(0, 0, 400, 120);
    document.body.append(container);
    const onDrop = vi.fn();
    const hook = renderHook(() =>
      usePointerDrag({ current: container } as RefObject<HTMLElement | null>, onDrop),
    );
    begin(hook, 0, 0);
    act(() => pointer('pointermove', 50, 50));
    expect(hook.result.current.drag).toEqual({ from: 0, before: 0, indicator: null });
    act(() => pointer('pointerup', 50, 50));
    expect(onDrop).toHaveBeenCalledWith(0, 0);
  });

  it('Esc отменяет перенос и не закрывает окно редактора', () => {
    const { hook, onDrop } = setup();
    begin(hook, 0, 0);
    act(() => pointer('pointermove', 100, 90));
    expect(hook.result.current.drag).not.toBeNull();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    const stop = vi.spyOn(escape, 'stopPropagation');
    act(() => {
      window.dispatchEvent(escape);
    });
    expect(stop).toHaveBeenCalled();
    expect(hook.result.current.drag).toBeNull();
    act(() => pointer('pointerup', 100, 90));
    expect(onDrop).not.toHaveBeenCalled();

    // Движения после отмены слушателей не имеют.
    act(() => pointer('pointermove', 120, 90));
    expect(hook.result.current.drag).toBeNull();
  });

  it('pointercancel и размонтирование снимают слушателей', () => {
    const { hook, onDrop } = setup();
    begin(hook, 0, 0);
    act(() => pointer('pointermove', 100, 90));
    act(() => pointer('pointercancel', 100, 90));
    expect(onDrop).not.toHaveBeenCalled();
    expect(hook.result.current.drag).toBeNull();

    begin(hook, 0, 0);
    act(() => pointer('pointermove', 100, 90));
    hook.unmount();
    act(() => pointer('pointerup', 100, 90));
    expect(onDrop).not.toHaveBeenCalled();
  });
});
