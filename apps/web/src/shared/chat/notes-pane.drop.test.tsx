// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ui } from '@nodus/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addFiles } from './composer-files.js';
import { NotesPane } from './notes-pane.js';

/**
 * Drop-зона файлов в витрине «Избранного» (#797): витрина — такая же лента,
 * как беседы и треды, и обязана принимать драг из Проводника. Примитив
 * `FeedDropzone` покрыт своим тестом (#242, гвард внутренних картинок);
 * здесь — что зона вообще СМОНТИРОВАНА у этой ленты и пишет в тот же scope,
 * из которого читает композер витрины (чипы вложений появляются сразу).
 */

vi.mock('./chat-queries.js', () => ({
  useConversations: () => ({ data: { items: [{ id: 'notes-1' }] } }),
  useConversationMessages: () => ({
    data: {
      // Одна запись: строки витрины (серии/пузыри) рендерятся тем же
      // конвейером, что в ленте — drop-зона не должна их ломать.
      items: [
        {
          id: 'm1',
          conversationId: 'notes-1',
          seq: 1,
          clientMessageId: 'client-1',
          author: { id: 'me', displayName: 'Я', avatarUrl: null },
          text: 'запись',
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
          createdAt: '2026-11-12T09:00:00Z',
        },
      ],
      nextCursor: null,
    },
    isLoading: false,
  }),
}));

vi.mock('./favorites-api.js', async () => {
  const actual = await vi.importActual<typeof import('./favorites-api.js')>('./favorites-api.js');
  return {
    ...actual,
    useFavorites: () => ({
      data: { pages: [{ items: [] }] },
      isLoading: false,
      hasNextPage: false,
      fetchNextPage: () => Promise.resolve({}),
    }),
  };
});

vi.mock('./message-menu.js', () => ({
  MessageMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./chat-composer.js', () => ({
  ChatComposer: () => <div data-testid="composer" />,
}));

vi.mock('./use-conversation-host.js', () => ({ useConversationHost: () => {} }));

vi.mock('./composer-files.js', async () => {
  const actual = await vi.importActual<typeof import('./composer-files.js')>('./composer-files.js');
  return { ...actual, addFiles: vi.fn() };
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotesPane conversationId="notes-1" />
    </QueryClientProvider>,
  );
}

/** Цель драга — лента витрины (примитив MessageScroller); обработчики зоны
 *  висят на её контейнере, событие доходит всплытием. */
function feedOf(container: HTMLElement): HTMLElement {
  const scroller = container.querySelector<HTMLElement>('[data-slot="message-scroller"]');
  if (!scroller) throw new Error('лента витрины не отрендерена');
  return scroller;
}

describe('NotesPane: drop-зона файлов (#797)', () => {
  it('файл из Проводника: оверлей при входе драга, файл уходит в композер витрины', () => {
    const { container } = renderPane();
    const feed = feedOf(container);
    const file = new File(['x'], 'отчёт.png', { type: 'image/png' });

    fireEvent.dragEnter(feed, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(screen.getByText(ui.chat.dropToAttach)).toBeTruthy();

    fireEvent.drop(feed, { dataTransfer: { types: ['Files'], files: [file] } });

    expect(vi.mocked(addFiles)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addFiles).mock.calls[0]).toEqual(['conversation:notes-1', [file]]);
    expect(screen.queryByText(ui.chat.dropToAttach)).toBeNull();
  });

  it('внутренний драг картинки (Files + html/uri-list) — не прикрепляет дубль', () => {
    const { container } = renderPane();
    const feed = feedOf(container);
    const fake = new File(['webp-bytes'], 'image.webp', { type: 'image/webp' });

    fireEvent.drop(feed, {
      dataTransfer: { types: ['Files', 'text/html', 'text/uri-list'], files: [fake] },
    });

    expect(vi.mocked(addFiles)).not.toHaveBeenCalled();
  });
});
