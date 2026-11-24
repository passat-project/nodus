// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Paginated } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { api } from '../api-client.js';
import { chatKeys } from './chat-keys.js';
import { ThreadPane } from './thread-pane.js';

vi.mock('../api-client.js', () => ({ api: vi.fn() }));

// jsdom без раскладки: ResizeObserver нужен композеру (авторост поля).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

/**
 * Окно треда канала (#1021): бар «Обсуждение N» на тонe рамы — обои чата
 * только ниже бара; крестика в шапке нет (закрытие — полоса «Обсудить» или
 * Esc); корень + ответы рендерятся общей лентой.
 */

const CONV = '11111111-1111-4111-8111-111111111111';
const ROOT = '22222222-2222-4222-8222-222222222222';

const msg = (id: string, seq: number, text: string): ChatMessage => ({
  id,
  conversationId: CONV,
  seq,
  clientMessageId: id,
  author: { id: 'u1', displayName: 'Автор Поста', avatarUrl: null },
  text,
  replyToId: null,
  reply: null,
  threadRootId: id === ROOT ? null : ROOT,
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
  createdAt: '2026-11-24T10:00:00Z',
});

const page: Paginated<ChatMessage> = {
  items: [
    msg(ROOT, 1, 'корневой пост канала'),
    msg('r1', 2, 'первый ответ в обсуждении'),
    msg('r2', 3, 'второй ответ в обсуждении'),
  ],
  nextCursor: null,
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path: unknown) => {
    const url = String(path);
    if (url.includes('/threads/state')) return { items: [], nextCursor: null };
    return page;
  });
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test',
    user: {
      id: 'me-1',
      email: 'me@nodus.by',
      displayName: 'Я Сам',
      permissions: [],
    },
  });
});

afterEach(cleanup);

function renderPane(variant: 'drill' | 'side' = 'side') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(chatKeys.thread(CONV, ROOT), page);
  client.setQueryData(chatKeys.threadStates(CONV), { items: [], nextCursor: null });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ThreadPane
          conversationId={CONV}
          threadRootId={ROOT}
          variant={variant}
          barClass="h-14"
          onClose={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('ThreadPane — окно обсуждения (#1021)', () => {
  it('бар «Обсуждение 2» рендерится; БЕЗ крестика закрытия (закрытие — полоса/Esc)', () => {
    renderPane();
    expect(screen.getByText('Обсуждение')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    // Крестика нет ни в side (раньше был), ни в drill («К ленте» — другая
    // роль): закрытие окна — повторный клик по полосе поста или Esc.
    expect(screen.queryByRole('button', { name: ui.common.close })).toBeNull();
  });

  it('корневой пост и ответы рендерятся общей лентой (серии ответов)', () => {
    renderPane();
    expect(screen.getByText('корневой пост канала')).toBeTruthy();
    expect(screen.getByText('первый ответ в обсуждении')).toBeTruthy();
    expect(screen.getByText('второй ответ в обсуждении')).toBeTruthy();
    // «Следить» — на месте (единственные действия шапки).
    expect(screen.getByRole('button', { name: ui.chat.watchThread })).toBeTruthy();
  });

  it('drill-вариант: кнопка «К ленте» вместо крестика', () => {
    renderPane('drill');
    expect(screen.getByRole('button', { name: ui.chat.backToFeed })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.common.close })).toBeNull();
  });
});
