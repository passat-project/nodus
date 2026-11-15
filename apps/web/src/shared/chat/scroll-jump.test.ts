// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  isMessageFullyVisible,
  revealMessage,
  scrollMessageIntoView,
  scrollToEndSmooth,
  scrollTopFor,
  smoothDurationFor,
} from './scroll-jump.js';

/** Инфраструктура jsdom: габариты через getBoundingClientRect-стабы,
 *  геометрия контейнера — defineProperty (jsdom не считает layout). */
interface Rect {
  top: number;
  bottom: number;
  height: number;
}

function rect(top: number, bottom: number): Rect {
  return { top, bottom, height: bottom - top };
}

function makeElement(): HTMLElement {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

function stubRects(el: HTMLElement, r: Rect): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r as unknown as DOMRect);
}

function makeContainer(opts: {
  rect: Rect;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}) {
  const el = makeElement();
  stubRects(el, opts.rect);
  Object.defineProperty(el, 'scrollTop', { value: opts.scrollTop, writable: true });
  Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight, configurable: true });
  el.scrollTo = vi.fn();
  return el;
}

const CONTAINER_RECT = rect(0, 600); // область ленты 600px

describe('smoothDurationFor — длительность без «вечности»', () => {
  it('близкий прыжок — базовые 320 мс', () => {
    expect(smoothDurationFor(1200)).toBe(320);
    expect(smoothDurationFor(-800)).toBe(320);
  });

  it('длинный — быстрее (≈10 px/мс), но это ещё анимация', () => {
    expect(smoothDurationFor(4000)).toBe(400);
  });

  it('гигантский чат — потолок 640 мс, пользователь не ждёт', () => {
    expect(smoothDurationFor(50_000)).toBe(640);
  });
});

/** Прыжок к цитате/закрепу (вердикт 25.09, п.1): видимая цель — ноль
 *  скролла; невидимая — центрирующий скролл с клампом, низ не отрывается. */
describe('scroll-jump — видно/не видно и кламп низа', () => {
  it('цель полностью видна — вспышка без скролла (outcome visible)', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 400,
      scrollHeight: 1000,
      clientHeight: 600,
    });
    const message = makeElement();
    stubRects(message, rect(100, 180)); // внутри [0, 600]
    expect(isMessageFullyVisible(message, container)).toBe(true);
    expect(revealMessage(message, container)).toBe('visible');
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it('цель обрезана снизу — считается невидимой, скроллим', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 300,
      scrollHeight: 900,
      clientHeight: 600,
    });
    const message = makeElement();
    stubRects(message, rect(520, 700)); // низ за пределами области
    expect(isMessageFullyVisible(message, container)).toBe(false);
    expect(revealMessage(message, container)).toBe('scrolled');
    expect(scrollTopFor(message, container, { align: 'center' })).toBeGreaterThan(0);
  });

  it('далёкая цель ниже: центрируется точным скроллом (desired внутри диапазона)', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 0,
      scrollHeight: 3000,
      clientHeight: 600,
    });
    const message = makeElement();
    // верх цели на 2000px от верха контента (учёт scrollTop=0)
    stubRects(message, rect(2000, 2080));
    expect(revealMessage(message, container)).toBe('scrolled');
    expect(scrollTopFor(message, container, { align: 'center' })).toBe(2000 - (600 - 80) / 2);
  });

  it('КЛЮЧЕВОЕ: центрирование у низа ленты КЛАМПИТСЯ на maxScroll — низ прижат, «дыры» нет', () => {
    // Лента прокручена к низу: maxScroll = 940; центр сообщения потребовал бы 1200.
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 940,
      scrollHeight: 1540,
      clientHeight: 600,
    });
    const message = makeElement();
    stubRects(message, rect(1800, 1880)); // центр требует scrollTop 1200 > max 940
    expect(revealMessage(message, container)).toBe('scrolled');
    // Спейсер НЕ растёт: запрос ровно maxScroll — нижнее сообщение остаётся у низа.
    expect(scrollTopFor(message, container, { align: 'center' })).toBe(940);
  });

  it('цель выше начала: кламп на 0', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 500,
      scrollHeight: 2000,
      clientHeight: 600,
    });
    const message = makeElement();
    stubRects(message, rect(-1500, -1440)); // далеко выше
    expect(revealMessage(message, container)).toBe('scrolled');
    expect(scrollTopFor(message, container, { align: 'center' })).toBe(0);
  });

  it('maxScroll = 0 (контент меньше области) — скролл в 0, не за пределы', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 0,
      scrollHeight: 600,
      clientHeight: 600,
    });
    const message = makeElement();
    stubRects(message, rect(700, 780)); // ниже области, но контент не прокручивается
    expect(revealMessage(message, container)).toBe('scrolled');
    expect(scrollTopFor(message, container, { align: 'center' })).toBe(0);
  });
});

/** Собственная плавная анимация (#845): цель пересчитывается каждый кадр,
 *  узел — по резолверу (React может пересоздать строку во время прокрутки). */
describe('scrollMessageIntoView — плавный режим', () => {
  function harness(container: HTMLElement, contentTop: number, height = 80) {
    let now = 0;
    let frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const flush = (ms: number) => {
      now += ms;
      const batch = frames;
      frames = [];
      for (const cb of batch) cb(now);
    };
    const finish = () => {
      for (let i = 0; i < 10; i += 1) flush(50);
    };
    const restore = () => {
      raf.mockRestore();
      clock.mockRestore();
    };
    // Геометрия цели «в контенте»: экранная позиция зависит от scrollTop.
    return { flush, finish, restore, contentTop, container, height };
  }

  function liveStub(el: HTMLElement, container: HTMLElement, contentTop: number, height: number) {
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => {
      const top = contentTop - container.scrollTop;
      return rect(top, top + height) as unknown as DOMRect;
    });
  }

  it('доезжает до цели за ~320мс и снапится по живой геометрии', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 0,
      scrollHeight: 3000,
      clientHeight: 600,
    });
    const message = makeElement();
    liveStub(message, container, 1500, 80);
    const h = harness(container, 1500);
    scrollMessageIntoView(message, container, { align: 'start', margin: 48, behavior: 'smooth' });
    h.finish();
    expect(container.scrollTop).toBe(1452);
    h.restore();
  });

  it('резолвер: узел пересоздан — прокрутка идёт к новому узлу', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 0,
      scrollHeight: 3000,
      clientHeight: 600,
    });
    const first = makeElement();
    const second = makeElement();
    liveStub(first, container, 1200, 80);
    liveStub(second, container, 2000, 80);
    let node: HTMLElement = first;
    const h = harness(container, 2000);
    scrollMessageIntoView(() => node, container, {
      align: 'start',
      margin: 48,
      behavior: 'smooth',
    });
    h.flush(50);
    node = second; // React пересоздал строку
    h.finish();
    expect(container.scrollTop).toBe(1952);
    h.restore();
  });

  it('резолвер вернул null — анимация встаёт, а не прыгает в начало', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 300,
      scrollHeight: 3000,
      clientHeight: 600,
    });
    const message = makeElement();
    liveStub(message, container, 1200, 80);
    const h = harness(container, 1200);
    let node: HTMLElement | null = message;
    scrollMessageIntoView(() => node, container, {
      align: 'start',
      margin: 48,
      behavior: 'smooth',
    });
    h.flush(50);
    const before = container.scrollTop;
    node = null;
    h.finish();
    expect(container.scrollTop).toBe(before);
    expect(before).not.toBe(0);
    h.restore();
  });

  it('в конец: своя плавная анимация (повторная стрелка не телепортирует)', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 600,
    });
    const h = harness(container, 0);
    scrollToEndSmooth(container);
    h.flush(50);
    // Первый кадр — только часть пути: это анимация, а не мгновенный скролл.
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(container.scrollTop).toBeLessThan(1400);
    h.finish();
    expect(container.scrollTop).toBe(1400); // maxScroll
    h.restore();
  });

  it('в конец: высота выросла на ходу — снап по новому maxScroll', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 600,
    });
    let scrollHeight = 2000;
    Object.defineProperty(container, 'scrollHeight', {
      get: () => scrollHeight,
      configurable: true,
    });
    const h = harness(container, 0);
    scrollToEndSmooth(container);
    h.flush(50);
    scrollHeight = 2400; // строка дорендерилась по ходу навигации
    h.finish();
    expect(container.scrollTop).toBe(1800);
    h.restore();
  });

  it('длинный прыжок АНИМИРУЕТСЯ (не телепорт), но не дольше 640 мс', () => {
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 0,
      scrollHeight: 20000,
      clientHeight: 600,
    });
    const message = makeElement();
    liveStub(message, container, 12000, 80);
    const h = harness(container, 12000);
    scrollMessageIntoView(message, container, { align: 'start', margin: 48, behavior: 'smooth' });
    h.flush(50);
    // Первый кадр — часть пути: перелёт видимый, а не мгновенный.
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(container.scrollTop).toBeLessThan(11952);
    h.finish(); // 500 мс: потолок 640 ещё не достигнут
    expect(container.scrollTop).toBeLessThan(11952);
    h.flush(200); // 700 мс — кривая закрылась, снап на цели
    expect(container.scrollTop).toBe(11952);
    h.restore();
  });

  it('системное «меньше движения» — мгновенно даже на коротком прыжке', () => {
    const mq = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', mq);
    const container = makeContainer({
      rect: CONTAINER_RECT,
      scrollTop: 0,
      scrollHeight: 3000,
      clientHeight: 600,
    });
    const message = makeElement();
    liveStub(message, container, 1200, 80);
    scrollMessageIntoView(message, container, { align: 'start', margin: 48, behavior: 'smooth' });
    expect(container.scrollTop).toBe(1152);
    expect(mq).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    vi.unstubAllGlobals();
  });
});
