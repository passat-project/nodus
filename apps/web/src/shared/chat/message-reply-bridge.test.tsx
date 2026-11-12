// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

vi.mock('../api-client.js', () => ({
  api: vi.fn(async () => ({ items: [], nextCursor: null, lastSeq: 0 })),
}));

import { ChatMessageItem } from './chat-message.js';
import { useChatPrefs } from './chat-prefs.js';
import { MessageMenu } from './message-menu.js';

/**
 * #729: ярлык «Ответить» стоит СБОКУ от пузыря. Чтобы его можно было поймать
 * мышью, контейнер-«мостик» начинается НА кромке пузыря (8px воздуха — паддинг
 * самой кнопки), а клики он ловит только когда сообщение под курсором.
 * Здесь — геометрия мостика и непрерывность hover-цепочки.
 */

const SCOPE = 'conversation:conv-1';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const message = (): ChatMessage => ({
  id: 'm1',
  conversationId: 'conv-1',
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'u1', displayName: 'Чужой Автор', avatarUrl: null },
  text: 'текст сообщения',
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
  createdAt: '2026-11-13T09:00:00.000Z',
});

function renderBuffer(mine = false) {
  const msg = message();
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MessageMenu message={msg} mine={mine} conversationId="conv-1" scope={SCOPE}>
          <ChatMessageItem message={msg} mine={mine} />
        </MessageMenu>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function replyButton(): HTMLElement {
  return screen.getByRole('button', { name: ui.chat.replyToMessage });
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  useChatPrefs.setState({ align: 'one' });
});

describe('Язычок «Ответить» (#729)', () => {
  it('язычок у чужого сообщения: 6px от правой кромки и straddle половиной', () => {
    renderBuffer();
    const button = replyButton();
    const slot = button.parentElement!;
    // Внутри границ пузыря: 6px от правого края, никаких выступов.
    expect(slot.classList.contains('right-1.5')).toBe(true);
    expect(slot.classList.contains('left-1.5')).toBe(false);
    for (const token of ['-right-3', '-left-3', 'right-full', 'left-full', 'left-1/2']) {
      expect(slot.classList.contains(token), `лишний сдвиг ${token}`).toBe(false);
    }
    expect(slot.classList.contains('-translate-x-1/2')).toBe(false);
    // Вертикально — половина над кромкой, половина под (14px → -7px).
    expect(slot.classList.contains('-top-[7px]')).toBe(true);
    // Не в потоке: раскладка ленты от язычка не меняется.
    expect(slot.classList.contains('absolute')).toBe(true);
  });

  it('у своего сообщения язычка нет вовсе (отвечать на себя нечего)', () => {
    useChatPrefs.setState({ align: 'both' });
    renderBuffer(true);

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });

  it('на узком пузыре язычок не шире пузыря (max-w-full + усечение)', () => {
    renderBuffer();
    const button = replyButton();
    const slot = button.parentElement!;
    expect(slot.classList.contains('max-w-full')).toBe(true);
    expect(button.classList.contains('max-w-full')).toBe(true);
    expect(button.classList.contains('truncate')).toBe(true);
    expect(button.classList.contains('whitespace-nowrap')).toBe(true);
    // Расширенные паддинги, чтобы текст не лип к краям.
    expect(button.classList.contains('px-2')).toBe(true);
  });

  it('в покое язычок прозрачен для кликов, на ховере пузыря — активен', () => {
    renderBuffer();
    const button = replyButton();
    const slot = button.parentElement!;

    // Плашка на кромке не ловит клики по пузырю/ленте, пока сообщение не под
    // курсором; на ховере пузыря становится интерактивной.
    expect(slot.classList.contains('pointer-events-none')).toBe(true);
    expect(slot.classList.contains('group-hover/bubble:pointer-events-auto')).toBe(true);
    expect(slot.classList.contains('pointer-events-auto')).toBe(false);
  });

  it('ховер пузыря → наведение на язычок: цепочка hover не рвётся', () => {
    renderBuffer();
    const button = replyButton();
    const bubble = button.closest('[data-slot="bubble"]')!;
    const slot = button.parentElement!;

    fireEvent.mouseEnter(bubble);
    fireEvent.mouseOver(button);

    // Язычок — потомок пузыря, а его бокс straddles кромку (7px внутри):
    // уход курсора с тела на язычок оставляет group-hover живым.
    expect(bubble.contains(slot)).toBe(true);
    expect(bubble.contains(button)).toBe(true);
    expect(button.classList.contains('group-hover/bubble:opacity-100')).toBe(true);
    expect(button.classList.contains('pointer-events-none')).toBe(true);
  });
});
