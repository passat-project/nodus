// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { isMessageFullyVisible, revealMessage, scrollTopFor } from './scroll-jump.js';

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
  Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight });
  el.scrollTo = vi.fn();
  return el;
}

const CONTAINER_RECT = rect(0, 600); // область ленты 600px

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
