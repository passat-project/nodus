// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EDGE_DELAY_MS, EDGE_STEP_MS } from '../../lib/board/edge-scroll.js';
import { BoardScroller } from './board-scroller.js';

/**
 * Навигация широкой доски (#366) на синтетической геометрии: видимая
 * область 1000px (x 0..1000), контент 3000px. jsdom не считает layout —
 * габариты и scrollLeft скроллера подменяются на экземпляре.
 */

const frames: FrameRequestCallback[] = [];
let now = 0;

function flushFrames(count: number) {
  act(() => {
    for (let i = 0; i < count; i++) {
      now += 16;
      const queue = frames.splice(0);
      queue.forEach((cb) => cb(now));
    }
  });
}

function mount() {
  const view = render(
    <BoardScroller>
      <section style={{ width: 240 }}>
        <header>
          <button type="button">⋯</button>
        </header>
        <button type="button">Карточка</button>
      </section>
    </BoardScroller>,
  );
  const el = view.container.querySelector<HTMLDivElement>('[data-board-scroller]')!;
  let left = 0;
  const clamp = (v: number) => Math.max(0, Math.min(2000, v));
  Object.defineProperties(el, {
    clientWidth: { configurable: true, value: 1000 },
    scrollWidth: { configurable: true, value: 3000 },
    scrollLeft: {
      configurable: true,
      get: () => left,
      set: (v: number) => {
        left = clamp(v);
      },
    },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({ left: 0, right: 1000, top: 0, bottom: 600, width: 1000, height: 600 }),
    },
    setPointerCapture: { configurable: true, value: vi.fn() },
    releasePointerCapture: { configurable: true, value: vi.fn() },
    scrollBy: {
      configurable: true,
      value: ({ left: dx = 0 }: ScrollToOptions) => {
        left = clamp(left + dx);
      },
    },
  });
  Object.defineProperty(el.firstElementChild!, 'offsetWidth', { configurable: true, value: 240 });
  // Флаги зон пересчитываются по scroll — после подмены геометрии.
  fireEvent.scroll(el);
  const hint = (side: string) => view.container.querySelector(`[data-edge-hint="${side}"]`)!;
  return { el, leftHint: hint('left'), rightHint: hint('right') };
}

const move = (target: Element, clientX: number, buttons = 0) =>
  fireEvent.pointerMove(target, { clientX, buttons, pointerType: 'mouse' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => frames.splice(0));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  cleanup();
  frames.splice(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BoardScroller — прокрутка у края', () => {
  it('зона видна только в сторону, куда есть место', () => {
    const { leftHint, rightHint } = mount();
    expect(leftHint.className).toContain('opacity-0');
    expect(rightHint.className).toContain('opacity-100');
  });

  it('у правого края доска едет после паузы и стоит, когда курсор ушёл', () => {
    const { el } = mount();
    move(el, 995);
    act(() => {
      vi.advanceTimersByTime(EDGE_DELAY_MS - 1);
    });
    flushFrames(3);
    expect(el.scrollLeft).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    flushFrames(10);
    const travelled = el.scrollLeft;
    expect(travelled).toBeGreaterThan(0);
    move(el, 500);
    flushFrames(10);
    expect(el.scrollLeft).toBe(travelled);
  });

  it('у конца доски зона гаснет и прокрутка останавливается', () => {
    const { el, rightHint } = mount();
    el.scrollLeft = 1990;
    move(el, 999);
    act(() => {
      vi.advanceTimersByTime(EDGE_DELAY_MS);
    });
    flushFrames(60);
    expect(el.scrollLeft).toBe(2000);
    fireEvent.scroll(el);
    expect(rightHint.className).toContain('opacity-0');
    expect(frames).toHaveLength(0);
  });

  it('наведение на контрол шапки колонки у края доску не листает', () => {
    const { el } = mount();
    move(el.querySelector('header button')!, 995);
    act(() => {
      vi.advanceTimersByTime(EDGE_DELAY_MS);
    });
    flushFrames(10);
    expect(el.scrollLeft).toBe(0);
  });
});

describe('BoardScroller — prefers-reduced-motion', () => {
  it('без плавности: шаг на колонку после паузы и далее раз в EDGE_STEP_MS, кадров нет', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { el } = mount();
    move(el, 995);
    act(() => {
      vi.advanceTimersByTime(EDGE_DELAY_MS);
    });
    expect(el.scrollLeft).toBe(240);
    expect(frames).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(EDGE_STEP_MS - 1);
    });
    expect(el.scrollLeft).toBe(240);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(el.scrollLeft).toBe(480);
    move(el, 500);
    act(() => {
      vi.advanceTimersByTime(EDGE_STEP_MS * 3);
    });
    expect(el.scrollLeft).toBe(480);
  });
});

describe('BoardScroller — drag-to-pan', () => {
  it('фон тянется зажатой кнопкой мыши', () => {
    const { el } = mount();
    fireEvent.pointerDown(el, { button: 0, clientX: 500, pointerType: 'mouse' });
    move(el, 498, 1);
    expect(el.scrollLeft).toBe(0);
    move(el, 400, 1);
    expect(el.scrollLeft).toBe(100);
    fireEvent.pointerUp(el, { pointerType: 'mouse' });
    move(el, 300);
    expect(el.scrollLeft).toBe(100);
  });

  it('с карточки pan не начинается — её тянет dnd-kit', () => {
    const { el } = mount();
    const card = el.querySelector('section > button')!;
    fireEvent.pointerDown(card, { button: 0, clientX: 500, pointerType: 'mouse' });
    move(card, 300, 1);
    expect(el.scrollLeft).toBe(0);
  });
});
