// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, useCallback, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { useHistoryLoader } from './use-history-loader.js';

// jsdom не знает IntersectionObserver — сентинел тут не тестируем (только
// компенсацию), достаточно бездействующего стаба.
class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.defineProperty(globalThis, 'IntersectionObserver', {
  value: IntersectionObserverStub,
  configurable: true,
});

/**
 * Компенсация скролла при преппенде истории (#307, ревью): якорь
    расходуется ТОЛЬКО на смену первого элемента (преппенд) — аппенд
 * чужого события в окне полёта позицию не сдвигает, настоящий преппенд
 * компенсируется высотой добавленного контента.
 */

const CONV = '11111111-1111-4111-8111-111111111111';

const m = (id: string): ChatMessage => ({
  id,
  conversationId: CONV,
  seq: 0,
  clientMessageId: id,
  author: { id: 'u1', displayName: 'Автор', avatarUrl: null },
  text: `текст ${id}`,
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
  createdAt: '2026-10-07T10:00:00Z',
});

interface HarnessProps {
  items: ChatMessage[];
  onLoadMore: () => Promise<boolean>;
  viewport: HTMLDivElement;
}

let probe: { loadOlder: () => Promise<boolean> } | null = null;

function HistoryHarness({ items, onLoadMore, viewport }: HarnessProps) {
  const stableLoadMore = useCallback(onLoadMore, [onLoadMore]);
  const { topSentinel, loadOlder } = useHistoryLoader({
    conversationId: CONV,
    viewportRef: { current: viewport },
    hasMore: true,
    items,
    loadMore: stableLoadMore,
  });
  probe = { loadOlder };
  return createElement('div', null, topSentinel);
}

/** jsdom не считает layout: метрики вьюпорта — контролируемыми геттерами. */
function fakeViewport(height: () => number): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { get: height, configurable: true });
  el.scrollTop = 0;
  document.body.append(el);
  return el;
}

function withClient(node: ReactNode): ReactNode {
  return createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    node,
  );
}

describe('useHistoryLoader — компенсация скролла (#307)', () => {
  afterEach(() => {
    probe = null;
    cleanup();
    document.body.innerHTML = '';
  });

  it('преппенд в окне полёта сдвигает scrollTop на прирост высоты', async () => {
    let height = 100;
    const viewport = fakeViewport(() => height);
    const { rerender } = render(
      withClient(
        createElement(HistoryHarness, {
          items: [m('a'), m('b')],
          onLoadMore: () => new Promise<boolean>(() => {}),
          viewport,
        }),
      ),
    );
    viewport.scrollTop = 40;
    void probe!.loadOlder(); // якорь снят: top=40, height=100

    height = 130; // страница пришла: контент вырос на 30
    rerender(
      withClient(
        createElement(HistoryHarness, {
          items: [m('old'), m('a'), m('b')],
          onLoadMore: () => new Promise<boolean>(() => {}),
          viewport,
        }),
      ),
    );
    expect(viewport.scrollTop).toBe(70); // 40 + 30
  });

  it('аппенд чужого события в окне полёта якорь НЕ расходует', async () => {
    let height = 100;
    const viewport = fakeViewport(() => height);
    const props = {
      onLoadMore: () => new Promise<boolean>(() => {}),
      viewport,
    };
    const { rerender } = render(
      withClient(createElement(HistoryHarness, { ...props, items: [m('a'), m('b')] })),
    );
    viewport.scrollTop = 40;
    void probe!.loadOlder();

    height = 120; // чужое сообщение дописано в хвост — лента у низа, не дёргаем
    rerender(
      withClient(createElement(HistoryHarness, { ...props, items: [m('a'), m('b'), m('new')] })),
    );
    expect(viewport.scrollTop).toBe(40); // якорь цел: первый элемент тот же

    height = 150; // теперь настоящая страница истории пришла сверху
    rerender(
      withClient(
        createElement(HistoryHarness, {
          ...props,
          items: [m('old'), m('a'), m('b'), m('new')],
        }),
      ),
    );
    expect(viewport.scrollTop).toBe(90); // 40 + 50: вся высота преппенда
  });

  it('патч без смены состава (тот же первый id) якорь не тратит', () => {
    let height = 100;
    const viewport = fakeViewport(() => height);
    const props = {
      onLoadMore: () => new Promise<boolean>(() => {}),
      viewport,
    };
    const { rerender } = render(
      withClient(createElement(HistoryHarness, { ...props, items: [m('a')] })),
    );
    viewport.scrollTop = 40;
    void probe!.loadOlder();

    height = 110; // реакция/прочтение выросли контент — первый элемент тот же
    rerender(withClient(createElement(HistoryHarness, { ...props, items: [m('a')] })));
    expect(viewport.scrollTop).toBe(40);
  });
});
