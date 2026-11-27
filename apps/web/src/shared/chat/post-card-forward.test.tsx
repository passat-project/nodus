// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { useJumpStore } from './jump-store.js';
import { PostCard } from './post-card.js';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const renderCard = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );

/** Атрибуция пересылки в карточке поста канала (#1072): корневые копии несут
 *  ту же пометку «Переслано от», что пузыри чата, — с переходом к оригиналу. */

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
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
  threadRepliesCount: 0,
  reactions: [],
  attachments: [],
  editedAt: null,
  readAt: null,
  readBy: [],
  urgent: false,
  mentionedUserIds: [],
  linkPreview: null,
  createdAt: '2026-09-30T09:00:00Z',
  ...overrides,
});

const base = {
  mine: false,
  atEnd: false,
  showName: true,
  repliesCount: 0,
  participants: [],
  lastReplyAt: null,
  threadUnread: false,
  reactionsHidden: true,
  threadOpen: false,
  onToggleThread: vi.fn(),
};

afterEach(cleanup);

describe('PostCard — атрибуция пересылки (#1072)', () => {
  const forwarded = message({
    forwardedFrom: {
      author: { id: 'src-author', displayName: 'Анна Смирнова', avatarUrl: null },
      conversationId: 'conv-src',
      messageId: 'src-msg',
      threadRootId: null,
    },
  });

  it('пересланный пост несёт «Переслано от»; обычный — нет', () => {
    const fwd = renderCard(<PostCard {...base} message={forwarded} />);
    expect(fwd.container.querySelector('[data-slot="post-surface"]')!.textContent).toContain(
      'Переслано от',
    );
    const plain = renderCard(<PostCard {...base} message={message()} />);
    expect(plain.container.querySelector('[data-slot="post-surface"]')!.textContent).not.toContain(
      'Переслано от',
    );
  });

  it('клик по имени источника — прыжок к оригиналу (jump-store)', () => {
    const { container } = renderCard(<PostCard {...base} message={forwarded} />);
    const card = container.querySelector('[data-slot="post-surface"]') as HTMLElement;
    const source = [...card.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('Анна Смирнова'),
    ) as HTMLElement;
    fireEvent.click(source);
    expect(useJumpStore.getState().target).toMatchObject({
      conversationId: 'conv-src',
      messageId: 'src-msg',
    });
  });
});
