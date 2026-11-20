// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const router = vi.hoisted(() => ({ searchStr: '' }));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: router.searchStr } }),
}));

import { useCircuitAxisY } from './use-circuit-axis.js';
import { CIRCUIT_REMEASURE } from './circuit-geometry.js';
import { useShellStore } from './shell-store.js';

/**
 * Живая ось контура (замечание владельца 17.11.2026): в шелле — низ топбара,
 * в открытой карточке мессенджера — низ её хедера; вход в карточку ждёт
 * оседания FLIP (480 мс), выход и перемер по resize/событию — сразу.
 * Окно ассистента ставит на эту ось свой верх.
 */

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function rectWithBottom(bottom: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 1200,
    height: bottom,
    right: 1200,
    bottom,
    toJSON: () => ({}),
  } as DOMRect;
}

function mountBar(attribute: 'data-topbar' | 'data-card-topbar', bottom: number): HTMLElement {
  const element = document.createElement('header');
  element.setAttribute(attribute, '');
  element.getBoundingClientRect = () => rectWithBottom(bottom);
  document.body.append(element);
  return element;
}

function Probe() {
  const axis = useCircuitAxisY();
  return createElement('span', { 'data-testid': 'axis' }, String(axis));
}

function axisText(): string {
  return screen.getByTestId('axis').textContent ?? '';
}

function fireRemeasure() {
  act(() => {
    window.dispatchEvent(new Event(CIRCUIT_REMEASURE));
  });
}

beforeEach(() => {
  router.searchStr = '';
  ResizeObserverStub.instances = [];
  localStorage.clear();
  useShellStore.setState({ cardClosing: false });
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useCircuitAxisY: ось шелла', () => {
  it('пока топбар не смонтирован — ось null', () => {
    render(createElement(Probe));
    expect(axisText()).toBe('null');
  });

  it('топбар есть — ось равна низу топбара', () => {
    mountBar('data-topbar', 64);
    render(createElement(Probe));
    expect(axisText()).toBe('64');
  });

  it('топбар появился/исчез — перемер по CIRCUIT_REMEASURE', () => {
    render(createElement(Probe));
    expect(axisText()).toBe('null');

    const bar = mountBar('data-topbar', 72);
    fireRemeasure();
    expect(axisText()).toBe('72');

    bar.remove();
    fireRemeasure();
    expect(axisText()).toBe('null');
  });

  it('ResizeObserver перемеряет ось (смена вкладок/размеров каркаса)', () => {
    const bar = mountBar('data-topbar', 64);
    render(createElement(Probe));
    expect(axisText()).toBe('64');

    bar.getBoundingClientRect = () => rectWithBottom(80);
    const observer = ResizeObserverStub.instances.at(-1)!;
    act(() => {
      observer.callback([], observer as unknown as ResizeObserver);
    });
    expect(axisText()).toBe('80');
  });
});

describe('useCircuitAxisY: карточка мессенджера', () => {
  it('уже открытая карточка (окно ассистента открыли позже) — замер сразу', () => {
    router.searchStr = '?cards=messenger:30000000-0000-4000-8000-000000000004';
    mountBar('data-card-topbar', 90);
    render(createElement(Probe));
    expect(axisText()).toBe('90');
  });

  it('вход в карточку: ось держится на шелле, замер — после оседания FLIP', () => {
    vi.useFakeTimers();
    mountBar('data-topbar', 64);
    const { rerender } = render(createElement(Probe));
    expect(axisText()).toBe('64');

    router.searchStr = '?cards=messenger:30000000-0000-4000-8000-000000000004';
    mountBar('data-card-topbar', 90);
    rerender(createElement(Probe));
    // Пока карточка раскрывается — ось шелла, перемеры подавлены.
    expect(axisText()).toBe('64');
    const observer = ResizeObserverStub.instances.at(-1)!;
    act(() => {
      observer.callback([], observer as unknown as ResizeObserver);
    });
    expect(axisText()).toBe('64');

    act(() => {
      vi.advanceTimersByTime(480);
    });
    expect(axisText()).toBe('90');
  });

  it('карточка закрывается: сразу назад на ось шелла, без ожидания', () => {
    router.searchStr = '?cards=messenger:30000000-0000-4000-8000-000000000004';
    useShellStore.setState({ cardClosing: true });
    mountBar('data-topbar', 64);
    render(createElement(Probe));
    expect(axisText()).toBe('64');
  });

  it('карточка без хедера — ось null, а не чужой низ', () => {
    router.searchStr = '?cards=messenger:30000000-0000-4000-8000-000000000004';
    render(createElement(Probe));
    expect(axisText()).toBe('null');
  });
});
