// @vitest-environment jsdom
import { useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { api } from '../api-client.js';
import { resetAttentionForTests, startAttentionTracking } from '../attention/attention-store.js';
import { SurfaceVisibilityProvider } from '../lib/surface-visibility.js';
import { useFeedViewportRead } from './use-viewport-read.js';

vi.mock('../api-client.js', () => ({ api: vi.fn(async () => ({})) }));
vi.mock('../api/api-mock-config.js', () => ({ isDomainMocked: () => false }));

/**
 * Квитанции просмотров под моделью внимания (#770): квитанция уходит только
 * при активном пользователе и видимой поверхности; возврат фокуса дочитывает
 * видимое; накрытая поверхность молчит.
 */

const CONV = '00000000-0000-4000-8000-0000000000c1';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as never);
  }

  disconnect(): void {}
}

const row: ChatMessage = {
  id: 'm1',
  conversationId: CONV,
  seq: 7,
  clientMessageId: 'c1',
  author: { id: 'u1', displayName: 'Автор', avatarUrl: null },
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
  createdAt: '2026-11-11T09:00:00Z',
};

function Feed() {
  const containerRef = useRef<HTMLDivElement>(null);
  useFeedViewportRead(CONV, containerRef, [row]);
  return (
    <div ref={containerRef}>
      <div data-message-id="m1">текст</div>
    </div>
  );
}

function renderFeed(visible = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let surfaceVisible = visible;
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <SurfaceVisibilityProvider visible={surfaceVisible}>
        <Feed />
      </SurfaceVisibilityProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(tree());
  return {
    show: () => {
      surfaceVisible = true;
      rerender(tree());
    },
  };
}

function readCalls(): number[] {
  return vi
    .mocked(api)
    .mock.calls.filter(([path]) => String(path).endsWith('/read'))
    .map(([, options]) => (options?.body as { upToSeq: number }).upToSeq);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({} as never);
  MockIntersectionObserver.instances = [];
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
  resetAttentionForTests();
  startAttentionTracking();
});

afterEach(() => {
  vi.useRealTimers();
  resetAttentionForTests();
});

describe('useFeedViewportRead + внимание (#770)', () => {
  it('активный пользователь у видимой поверхности — квитанция уходит', () => {
    renderFeed();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(readCalls()).toEqual([7]);
  });

  it('бездействие (нет ввода 30+ с) — квитанции нет; возврат фокуса дочитывает', () => {
    resetAttentionForTests({ lastInputAt: 0 });
    startAttentionTracking();
    renderFeed();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(readCalls()).toEqual([]);

    act(() => {
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(600);
    });
    expect(readCalls()).toEqual([7]);
  });

  it('накрытая поверхность не читает; вернулась на вид — дочитывает', () => {
    const feed = renderFeed(false);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(readCalls()).toEqual([]);

    act(() => {
      feed.show();
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(readCalls()).toEqual([7]);
  });

  it('«увидел и сразу свернул»: потеря внимания отправляет накопленное без троттла', () => {
    renderFeed(); // наблюдение уже случилось, таймер 500 мс ещё не истёк
    expect(readCalls()).toEqual([]);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    // flush по потере внимания — сразу, без ожидания троттла/возврата.
    expect(readCalls()).toEqual([7]);
  });
});
