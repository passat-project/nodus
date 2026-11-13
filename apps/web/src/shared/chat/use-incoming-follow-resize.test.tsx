// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { resetAttentionForTests } from '../attention/attention-store.js';
import { useIncomingFollow } from './use-incoming-follow.js';

/** #847: ResizeObserver вьюпорта ленты — рост/сброс поля ввода не отрывает
 *  ленту от дна, стрелка «вниз» после удаления текста не появляется. */

function Probe({ enabled, viewport }: { enabled: boolean; viewport: HTMLElement }) {
  useIncomingFollow({
    scope: 'conversation:c1',
    items: [] as ChatMessage[],
    meId: undefined,
    viewportRef: { current: viewport },
    enabled,
  });
  return null;
}

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
  constructor(readonly cb: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }
}

function makeResizableViewport(scrollTop: number, clientHeight: number) {
  const state = { scrollTop, clientHeight };
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'scrollHeight', { value: 2603, configurable: true });
  Object.defineProperty(viewport, 'clientHeight', {
    get: () => state.clientHeight,
    configurable: true,
  });
  Object.defineProperty(viewport, 'scrollTop', {
    get: () => state.scrollTop,
    set: (v: number) => {
      state.scrollTop = v;
    },
    configurable: true,
  });
  return { viewport, state };
}

beforeEach(() => {
  resetAttentionForTests();
  ResizeObserverStub.instances = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useIncomingFollow — ResizeObserver вьюпорта (#847)', () => {
  it('поле выросло, затем текст удалили — лента возвращается точно на низ', () => {
    const { viewport, state } = makeResizableViewport(1835, 768); // у низа
    const { unmount } = render(<Probe enabled viewport={viewport} />);
    const [ro] = ResizeObserverStub.instances;
    expect(ro?.observe).toHaveBeenCalledWith(viewport);

    state.clientHeight = 639; // композер вырос на 129
    act(() => {
      ro!.cb([], ro as unknown as ResizeObserver);
    });
    expect(state.scrollTop).toBe(1964); // низ остался низом

    // Подряд идущий колбэк без изменения высоты — не двигает.
    act(() => {
      ro!.cb([], ro as unknown as ResizeObserver);
    });
    expect(state.scrollTop).toBe(1964);

    // Текст удалили — поле уменьшилось: точный низ под новую высоту,
    // без остаточной щели (иначе появляется стрелка «вниз»).
    state.clientHeight = 768;
    act(() => {
      ro!.cb([], ro as unknown as ResizeObserver);
    });
    expect(state.scrollTop).toBe(1835);
    expect(2603 - state.scrollTop - state.clientHeight).toBe(0);

    unmount();
    expect(ro?.disconnect).toHaveBeenCalled();
  });

  it('пользователь в истории — рост поля ленту не двигает', () => {
    const { viewport, state } = makeResizableViewport(900, 768);
    render(<Probe enabled viewport={viewport} />);
    const [ro] = ResizeObserverStub.instances;
    state.clientHeight = 639;
    act(() => {
      ro!.cb([], ro as unknown as ResizeObserver);
    });
    expect(state.scrollTop).toBe(900);
  });
});
