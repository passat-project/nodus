// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MessageScroller,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@nodus/ui/components/message-scroller';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { FeedPostRow } from './feed-post-row.js';

/**
 * Полоса «Обсудить» — ТУМБЛЕР треда (#1021): клик по полосе поста открывает
 * окно обсуждения (onOpenThread с id поста), повторный клик по ТОЙ ЖЕ полосе
 * при открытом треде этого поста закрывает (onCloseThread); aria-expanded
 * отражает состояние. Клик по телу карточки тред не открывает — это проверено
 * в post-card.test.tsx; здесь — проводка тумблера на уровне строки ленты.
 */

const message = (): ChatMessage => ({
  id: 'p1',
  conversationId: 'conv-1',
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'a', displayName: 'Иван Петров', avatarUrl: null },
  text: 'текст поста',
  replyToId: null,
  reply: null,
  deletedAt: null,
  pinned: false,
  forwardedFrom: null,
  threadRootId: null,
  threadRepliesCount: 2,
  reactions: [],
  attachments: [],
  editedAt: null,
  readAt: null,
  readBy: [],
  urgent: false,
  mentionedUserIds: [],
  linkPreview: null,
  createdAt: '2026-11-24T09:00:00Z',
});

const base = {
  mine: false,
  atEnd: false,
  showName: true,
  replies: [],
  threadUnread: false,
  selectionActive: false,
  selected: false,
  onToggle: vi.fn(),
  conversationId: 'conv-1',
  scope: 'feed:conv-1',
  getSelectedMessages: () => [],
};

afterEach(cleanup);

function renderRow(openThreadId: string | null) {
  const onOpenThread = vi.fn();
  const onCloseThread = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      {/* Строка поста живёт внутри скроллер-примитива ленты — тот же хост. */}
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="">
          <MessageScrollerViewport>
            <FeedPostRow
              {...base}
              message={message()}
              onOpenThread={onOpenThread}
              onCloseThread={onCloseThread}
              openThreadId={openThreadId}
            />
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </QueryClientProvider>,
  );
  return { view, onOpenThread, onCloseThread };
}

describe('FeedPostRow — полоса «Обсудить» как тумблер треда (#1021)', () => {
  it('тред этого поста закрыт: клик по полосе открывает (onOpenThread с id), aria-expanded=false', () => {
    const { onOpenThread, onCloseThread } = renderRow(null);
    const strip = screen.getByRole('button', { name: /Обсудить/ }) as HTMLElement;
    expect(strip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(strip);
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    expect(onOpenThread).toHaveBeenCalledWith('p1');
    expect(onCloseThread).not.toHaveBeenCalled();
  });

  it('тред этого поста открыт: клик по ТОЙ ЖЕ полосе закрывает (onCloseThread), aria-expanded=true', () => {
    const { onOpenThread, onCloseThread } = renderRow('p1');
    const strip = screen.getByRole('button', { name: /Обсудить/ }) as HTMLElement;
    expect(strip.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(strip);
    expect(onCloseThread).toHaveBeenCalledTimes(1);
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it('открыт тред ДРУГОГО поста: клик открывает свой, а не закрывает чужой', () => {
    const { onOpenThread, onCloseThread } = renderRow('p2');
    const strip = screen.getByRole('button', { name: /Обсудить/ }) as HTMLElement;
    expect(strip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(strip);
    expect(onOpenThread).toHaveBeenCalledWith('p1');
    expect(onCloseThread).not.toHaveBeenCalled();
  });
});
