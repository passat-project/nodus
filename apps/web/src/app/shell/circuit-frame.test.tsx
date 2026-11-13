// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { snapPx } from '@nodus/ui/components/node-edge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircuitFrame } from './circuit-frame.js';

/**
 * Вспышка контура и width-транзиции контейнеров (баг владельца 14.10.2026:
 * «кликаю модули подряд — вспышка перестаёт вылетать, виноват мессенджер»).
 *
 * Переход на/с мессенджера прячет правую служебную полосу — у неё
 * width-транзиция, и она совпадает со сменой фокуса навигации. Тест гоняет
 * НАСТОЯЩИЙ CircuitFrame на синтетической геометрии шелла: смена маршрута +
 * транзиция контейнера → вспышка обязана вылететь на кадре оседания и вести
 * к порту НОВОГО модуля и засечке его активной вкладки.
 */

let pathname = '/home';
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname, searchStr: '' } }),
}));

const RAF_QUEUE: { id: number; cb: FrameRequestCallback }[] = [];
let rafId = 1;
const RAF_IDS = new Map<number, FrameRequestCallback>();

function flushFrames(max = 3) {
  act(() => {
    for (let i = 0; i < max && RAF_QUEUE.length > 0; i++) {
      const frame = RAF_QUEUE.shift()!;
      if (!RAF_IDS.has(frame.id)) continue;
      frame.cb(performance.now());
    }
  });
}

/** `transitionrun`/`transitionend` с propertyName — jsdom свойства не несёт.
 *  `settle` — прогнать кадр оседания СРАЗУ за transitionend: в браузере кадр
 *  приходит следующим тиком после события, тесту нужен явный порядок. */
function fireTransition(type: 'transitionrun' | 'transitionend', el: Element) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'width' });
  act(() => {
    el.dispatchEvent(event);
  });
}

/** Коммит React-эффектов после смены маршрута: пустой act прогоняет
 *  layout-эффект (перемер → focus-effect) ДО старта width-транзиции — ровно
 *  та гонка живого шелла, из-за которой вспышку и глушил width-transition
 *  правой полосы (баг 14.10.2026). */
function commitEffects() {
  act(() => {});
}

/** Готовность контура: первый замер в живом шелле случается до кликов —
 *  кадры прогоняются и недостающие запускаются сценарием. */
function ensureMeasured() {
  commitEffects();
  flushFrames(4);
  commitEffects();
}

/** Рейс оседания транзиции: run → кадр движения → end (фокус не сменился).
 *  Геометрия к этому моменту уже новая (commitEffects). */
function rafSettleRace(edge: Element) {
  fireTransition('transitionrun', edge);
  commitEffects();
  flushFrames(1);
  fireTransition('transitionend', edge);
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function rect(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

const SHELL_ROWS: Record<string, number> = {
  '/home': 100,
  '/tasks': 140,
  '/chat': 400,
  '/employees': 600,
};

/** Синтетический шелл ОДИН раз: топбар, мягкая рама, порты всех модулей.
 *  Контур меряет живой DOM — пересборка body рвала топбар (блока trap). */
function mountShellDom() {
  const header = document.createElement('header');
  header.setAttribute('data-topbar', '');
  header.getBoundingClientRect = () => rect(0, 0, 1200, 64);
  document.body.append(header);
  const frame = document.createElement('div');
  frame.setAttribute('data-soft-frame', '');
  frame.getBoundingClientRect = () => rect(0, 8, 1200, 800);
  document.body.append(frame);
  for (const [to, top] of Object.entries(SHELL_ROWS)) {
    const port = document.createElement('span');
    port.setAttribute('data-module-port', to);
    port.getBoundingClientRect = () => rect(60, top, 7, 7);
    document.body.append(port);
  }
}

/** Активная навигация: порт модуля + вкладки топбара (смена маршрута). */
function setNav(to: string, tabs: string[] = []) {
  for (const el of document.querySelectorAll('[data-module-port]')) {
    if (el.getAttribute('data-module-port') === to) el.setAttribute('data-active', 'true');
    else el.removeAttribute('data-active');
  }
  const header = document.querySelector('[data-topbar]')!;
  for (const el of header.querySelectorAll('[data-tab-port]')) el.remove();
  tabs.forEach((label, i) => {
    const tab = document.createElement('span');
    tab.setAttribute('data-tab-port', '');
    if (i === 0) tab.setAttribute('data-active', 'true');
    tab.getBoundingClientRect = () => rect(200 + i * 120, 20, 100, 24);
    tab.textContent = label;
    header.append(tab);
  });
}

function pulseEl(): Element | null {
  return document.querySelector('.dock-edge-fade');
}

beforeEach(() => {
  pathname = '/home';
  RAF_QUEUE.length = 0;
  RAF_IDS.clear();
  rafId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = rafId++;
    RAF_IDS.set(id, cb);
    RAF_QUEUE.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    RAF_IDS.delete(id);
    const i = RAF_QUEUE.findIndex((f) => f.id === id);
    if (i >= 0) RAF_QUEUE.splice(i, 1);
  });
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // Вспышка рисуется только без prefers-reduced-motion.
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('узел бокового шва схлопнутой рейки (#851)', () => {
  it('сидит РОВНО на оси контура, а не на вертикали rem-якоря', () => {
    mountShellDom();
    // Якорь как в живом шелле при UI-масштабе ×1.25: ось шапки = 80
    // (mt-2 10 + h-14 70), а рем-якорь — 79.75. До фикса кружок шёл за
    // якорем и висел на физический пиксель выше линии связи.
    const anchor = document.createElement('span');
    anchor.setAttribute('data-left-node', '');
    anchor.getBoundingClientRect = () => rect(72, 79, 1, 1);
    document.body.append(anchor);
    setNav('/chat', ['Чаты']);
    render(<CircuitFrame />);
    ensureMeasured();

    const seam = document.querySelector('svg circle');
    expect(seam).not.toBeNull();
    // Ось линии — snapPx(axisY = 64); кружок обязан стоять на той же координате.
    expect(Number(seam!.getAttribute('cy'))).toBe(snapPx(64));
  });
});

describe('вспышка контура на смене модуля с width-транзицией контейнера', () => {
  it('на движении вспышки нет; на кадре оседания — вспышка к новому модулю и его вкладке', () => {
    // Стартуем на Главной.
    mountShellDom();
    setNav('/home');
    render(<CircuitFrame />);
    ensureMeasured();

    // Клик по мессенджеру: React-коммит маршрута, следом полоса поехала
    // (как в живом шелле — транзиция в кадре смены маршрута).
    pathname = '/chat';
    setNav('/chat', ['Чаты', 'Чаты задач']);
    const edge = document.createElement('aside');
    document.body.append(edge);
    rafSettleRace(edge);
    flushFrames(1); // кадр оседания
    const pulse = pulseEl();
    expect(pulse).not.toBeNull();
    // Маршрут вспышки: отвод модуля мессенджера (y=400) → шина → ось шапки →
    // засечка активной вкладки (x=200..250).
    const d = pulse!.querySelector('path')?.getAttribute('d') ?? '';
    // y=403.5 — отвод порта мессенджера (row 400); засечка ведёт к активной
    // вкладке «Чаты» (центр 250 → низ засечки 50.5); ось идёт по y=64.5 —
    // линии Главной (y=103.5) в маршруте нет.
    expect(d).toContain('403.5');
    expect(d).toContain('250.5');
    expect(d).not.toContain('103.5');
  });
});
