// @vitest-environment jsdom
import { useRef } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStickyBottom } from './use-sticky-bottom.js';

/** Мини-стенд: скроллер с управляемой высотой содержимого. */
function Harness({ height }: { height: { value: number } }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useStickyBottom(viewportRef);
  return (
    <div
      ref={(el) => {
        viewportRef.current = el;
        if (!el) return;
        Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => height.value });
        Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 100 });
      }}
    >
      <div data-slot="message-scroller-content" />
    </div>
  );
}

class FakeResizeObserver {
  static callback: (() => void) | null = null;
  constructor(callback: () => void) {
    FakeResizeObserver.callback = callback;
  }
  observe(): void {}
  disconnect(): void {
    FakeResizeObserver.callback = null;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeResizeObserver.callback = null;
});

describe('useStickyBottom: лента держится у низа во время роста ответа', () => {
  it('рост содержимого у низа — scrollTop доезжает до низа до отрисовки', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const height = { value: 100 };
    const { container } = render(<Harness height={height} />);
    const viewport = container.firstElementChild as HTMLElement;

    height.value = 1_000;
    FakeResizeObserver.callback?.();

    expect(viewport.scrollTop).toBe(900);
  });

  it('сотрудник отлистал вверх — рост содержимого ленту не дёргает', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const height = { value: 100 };
    const { container } = render(<Harness height={height} />);
    const viewport = container.firstElementChild as HTMLElement;

    // Читает историю: лента далеко от низа.
    viewport.scrollTop = 0;
    height.value = 1_000;
    viewport.dispatchEvent(new Event('scroll'));

    height.value = 1_100;
    FakeResizeObserver.callback?.();

    expect(viewport.scrollTop).toBe(0);
  });
});
