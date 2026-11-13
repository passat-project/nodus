// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { resetAttentionForTests } from '../attention/attention-store.js';
import { useScrollEndStore } from './scroll-end-store.js';
import { isAtBottom, pinScrollDelta, useIncomingFollow } from './use-incoming-follow.js';

/** Догон входящих (#132): «у низа» — просит скролл в конец, в истории — нет;
 *  свои сообщения догон просит сам композер (хук их пропускает). */

const msg = (id: string, authorId: string): ChatMessage => ({
  id,
  conversationId: 'c1',
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: authorId, displayName: authorId, avatarUrl: null },
  text: 'текст',
  replyToId: null,
  reply: null,
  threadRootId: null,
  threadRepliesCount: 0,
  reactions: [],
  attachments: [],
  editedAt: null,
  deletedAt: null,
  pinned: false,
  forwardedFrom: null,
  readAt: null,
  readBy: [],
  urgent: false,
  mentionedUserIds: [],
  linkPreview: null,
  createdAt: '2026-09-28T09:00:00Z',
});

function makeViewport(scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
  return el;
}

function Probe({
  items,
  enabled,
  viewport,
  meId,
}: {
  items: ChatMessage[];
  enabled: boolean;
  viewport: HTMLElement;
  meId?: string;
}) {
  useIncomingFollow({
    scope: 'conversation:c1',
    items,
    meId,
    viewportRef: { current: viewport },
    enabled,
  });
  return null;
}

beforeEach(() => {
  // JSdom не в фокусе: для догона модель внимания должна быть «окно на виду».
  resetAttentionForTests();
});

afterEach(() => {
  cleanup();
  useScrollEndStore.setState({ requests: {} });
});

describe('isAtBottom', () => {
  it('порог 32px от низа', () => {
    const vp = makeViewport(1000, 500);
    vp.scrollTop = 469; // остаток 31px — у низа
    expect(isAtBottom(vp)).toBe(true);
    vp.scrollTop = 460; // остаток 40px — в истории
    expect(isAtBottom(vp)).toBe(false);
  });
});

describe('pinScrollDelta (#847: рост поля ввода)', () => {
  it('поле выросло (вьюпорт сжался) у низа — поднимаем содержимое на дельту', () => {
    expect(pinScrollDelta(768, 680, true)).toBe(88);
    // scrollTop += 88 — низ сообщений остаётся над композером.
    expect(pinScrollDelta(680, 760, true)).toBe(-80);
  });

  it('не у низа — рост поля ленту не двигает (читаем историю)', () => {
    expect(pinScrollDelta(768, 680, false)).toBe(0);
  });

  it('высота не изменилась — сдвига нет', () => {
    expect(pinScrollDelta(700, 700, true)).toBe(0);
  });
});

describe('useIncomingFollow', () => {
  it('чужое сообщение при «у низа» — запрос догона auto', async () => {
    const viewport = makeViewport(1000, 500);
    viewport.scrollTop = 480; // у низа
    const spy = vi.fn();
    const unsub = useScrollEndStore.subscribe((s) => {
      const r = s.requests['conversation:c1'];
      if (r) spy(r.behavior);
    });
    const { rerender } = render(<Probe items={[msg('m1', 'them')]} enabled viewport={viewport} />);
    // Прибыло чужое.
    act(() => {
      rerender(
        <Probe items={[msg('m1', 'them'), msg('m2', 'them')]} enabled viewport={viewport} />,
      );
    });
    expect(spy).toHaveBeenCalledWith('auto');
    unsub();
  });

  it('в истории (выше низа) — догона нет; своё сообщение — тоже нет', async () => {
    const viewport = makeViewport(1000, 500);
    viewport.scrollTop = 100; // далеко от низа
    const spy = vi.fn();
    const unsub = useScrollEndStore.subscribe((s) => {
      if (s.requests['conversation:c1']) spy();
    });
    const { rerender } = render(
      <Probe items={[msg('m1', 'them')]} enabled viewport={viewport} meId="me" />,
    );
    act(() => {
      rerender(
        <Probe
          items={[msg('m1', 'them'), msg('m2', 'them'), msg('m3', 'me')]}
          enabled
          viewport={viewport}
          meId="me"
        />,
      );
    });
    expect(spy).not.toHaveBeenCalled();
    unsub();
  });

  it('в фоне (трей/свёрнуто/не в фокусе) — догона нет (#770)', async () => {
    resetAttentionForTests({ focused: false });
    const viewport = makeViewport(1000, 500);
    viewport.scrollTop = 480; // у низа
    const spy = vi.fn();
    const unsub = useScrollEndStore.subscribe((s) => {
      if (s.requests['conversation:c1']) spy();
    });
    const { rerender } = render(<Probe items={[msg('m1', 'them')]} enabled viewport={viewport} />);
    act(() => {
      rerender(
        <Probe items={[msg('m1', 'them'), msg('m2', 'them')]} enabled viewport={viewport} />,
      );
    });
    expect(spy).not.toHaveBeenCalled();
    unsub();
  });

  it('enabled=false (якорь открытия) — догона нет', async () => {
    const viewport = makeViewport(1000, 500);
    viewport.scrollTop = 480;
    const spy = vi.fn();
    const unsub = useScrollEndStore.subscribe((s) => {
      if (s.requests['conversation:c1']) spy();
    });
    const { rerender } = render(
      <Probe items={[msg('m1', 'them')]} enabled={false} viewport={viewport} />,
    );
    act(() => {
      rerender(
        <Probe
          items={[msg('m1', 'them'), msg('m2', 'them')]}
          enabled={false}
          viewport={viewport}
        />,
      );
    });
    expect(spy).not.toHaveBeenCalled();
    unsub();
  });

  it('pre-paint компенсация (р.5): рост scrollHeight у низа докручивает scrollTop синхронно', () => {
    // Баг «первая после F5 реакция дёргает ленту»: чип реакции растит
    // высоту последнего сообщения — пока пользователь у низа, scrollTop
    // дорисовывается ДО отрисовки кадра, рывка нет.
    const viewport = document.createElement('div');
    let scrollHeight = 1000;
    let scrollTop = 480; // 1000-480-500=20 ≤ 32 → у низа
    Object.defineProperty(viewport, 'scrollHeight', {
      get: () => scrollHeight,
      configurable: true,
    });
    Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(viewport, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
      configurable: true,
    });
    const { rerender } = render(<Probe items={[]} enabled viewport={viewport} />);
    // Высота выросла на 120 (появился чип реакции) до кадра отрисовки.
    scrollHeight = 1120;
    act(() => {
      rerender(<Probe items={[]} enabled viewport={viewport} />);
    });
    expect(scrollTop).toBe(600); // 480 + 120 — докручено синхронно с рендером
  });

  it('pre-paint компенсация: в истории и при enabled=false (якорь) — не крутит', () => {
    const viewport = document.createElement('div');
    let scrollHeight = 1000;
    let scrollTop = 100; // далеко от низа
    Object.defineProperty(viewport, 'scrollHeight', {
      get: () => scrollHeight,
      configurable: true,
    });
    Object.defineProperty(viewport, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(viewport, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
      configurable: true,
    });
    const { rerender } = render(<Probe items={[]} enabled viewport={viewport} />);
    scrollHeight = 1500;
    act(() => {
      rerender(<Probe items={[]} enabled viewport={viewport} />);
    });
    expect(scrollTop).toBe(100); // читает историю — низ «отклеился», не тянем

    // Фаза якоря (enabled=false): рост не компенсируем, высоту лишь помним.
    scrollHeight = 2000;
    act(() => {
      rerender(<Probe items={[]} enabled={false} viewport={viewport} />);
    });
    expect(scrollTop).toBe(100);
  });
});
