// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ConversationListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

vi.mock('../api-client.js', () => ({
  api: vi.fn(async () => ({ items: [], nextCursor: null, lastSeq: 0 })),
}));

import { MessageMenu } from './message-menu.js';
import { useAuthStore } from '../auth-store.js';
import { api } from '../api-client.js';

/** Структура контекстного меню (раунд 4): «Кто просмотрел» — ПОДМЕНЮ над
 * «Удалить» у своих живых сообщений с непустым readBy; у чужих / без
 * просмотров / в режиме селекта — подменю нет. Спека владельца: прежний
 * пункт с попапом «мгновенно пропадал» (война фокуса). */

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const msg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  conversationId: 'conv-1',
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'me', displayName: 'Я', avatarUrl: null },
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
  readAt: '2026-09-25T10:00:00.000Z',
  readBy: [
    { id: 'u1', displayName: 'Анна Первая', avatarUrl: null },
    { id: 'u2', displayName: 'Борис Второй', avatarUrl: null },
  ],
  urgent: false,
  mentionedUserIds: [],
  linkPreview: null,
  createdAt: '2026-09-25T09:00:00.000Z',
  ...overrides,
});

function renderMenu(message: ChatMessage, mine: boolean) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MessageMenu
        message={message}
        mine={mine}
        conversationId="conv-1"
        scope="conversation:conv-1"
      >
        {/* Поверхность сообщения: ПКМ-гейт пачки C открывает меню только
            по пузырю/посту/надгробию (data-slot). */}
        <span data-slot="bubble-content">пузырь</span>
      </MessageMenu>
    </QueryClientProvider>,
  );
}

function openMenu() {
  const bubble = screen.getByText('пузырь');
  fireEvent.contextMenu(bubble, { button: 2, clientX: 10, clientY: 10 });
  // Появление портала меню асинхронно (Radix) — ждём любой пункт.
  return screen.findByRole('menuitem', { name: ui.chat.menu.copy });
}

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('MessageMenu: подменю «Кто просмотрел» (раунд 4)', () => {
  it('своё сообщение с просмотрами: подменю есть, НАД «Удалить»', async () => {
    renderMenu(msg(), true);
    await openMenu();

    const submenuTrigger = screen.getByRole('menuitem', { name: ui.chat.whoViewed });
    expect(submenuTrigger).toBeTruthy();
    expect(submenuTrigger.getAttribute('data-slot')).toBe('context-menu-sub-trigger');

    // Порядок: подменю стоит выше пункта «Удалить» в DOM меню.
    const deleteItem = screen.getByRole('menuitem', { name: ui.chat.menu.delete });
    expect(submenuTrigger.compareDocumentPosition(deleteItem)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('чужое сообщение: подменю нет (просмотры видит автор)', async () => {
    renderMenu(msg(), false);
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: ui.chat.whoViewed })).toBeNull();
  });

  it('своё, но никто не просмотрел (readBy пуст): подменю нет', async () => {
    renderMenu(msg({ readBy: [], readAt: null }), true);
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: ui.chat.whoViewed })).toBeNull();
  });

  it('надгробие удалённого: подменю нет', async () => {
    renderMenu(msg({ deletedAt: '2026-09-25T10:30:00.000Z' }), true);
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: ui.chat.whoViewed })).toBeNull();
  });
});

describe('MessageMenu: окно-источник «Избранного» — Telegram-набор (#237)', () => {
  it('вне набора (ответить/правка/задача/закрепить/ссылка/просмотры) скрыты', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MessageMenu
          message={msg()}
          mine
          conversationId="conv-1"
          scope="notes-source:notes"
          variant="source-window"
        >
          <span data-slot="bubble-content">пузырь</span>
        </MessageMenu>
      </QueryClientProvider>,
    );
    const bubble = screen.getByText('пузырь');
    fireEvent.contextMenu(bubble, { button: 2, clientX: 10, clientY: 10 });
    await screen.findByRole('menuitem', { name: ui.chat.menu.copy });

    // Набор Telegram: копировать / переслать / выбрать / удалить.
    for (const label of [
      ui.chat.menu.copy,
      ui.chat.menu.forward,
      ui.chat.menu.select,
      ui.chat.menu.delete,
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();
    }
    // Команды ленты не показываются.
    for (const label of [
      ui.chat.menu.reply,
      ui.chat.menu.edit,
      ui.chat.menu.createTask,
      ui.chat.menu.pin,
      ui.chat.menu.copyLink,
      ui.chat.whoViewed,
    ]) {
      expect(screen.queryByRole('menuitem', { name: label })).toBeNull();
    }
  });
});

/** #245: видимость модераторского «Удалить» на ЧУЖИХ сообщениях —
 *  админ/владелец беседы и модератор портала (chat.moderate) в группах/
 *  каналах; участнику и вне group/project_channel — нет. */
describe('MessageMenu: модераторское «Удалить» (#245)', () => {
  const conv = (myRole: 'owner' | 'admin' | 'member', type = 'group'): ConversationListItem =>
    ({
      id: 'conv-1',
      type,
      title: 'Беседа',
      avatarUrl: null,
      myRole,
      permissions: {
        changeInfo: 'admin',
        addMembers: 'member',
        removeMembers: 'admin',
        post: 'member',
        manageSettings: 'owner',
      },
      draft: null,
      visibility: null,
      description: null,
      project: null,
      task: null,
      letter: null,
      membersPreview: [],
      membersCount: 2,
      lastMessage: null,
      lastActivityAt: null,
      unreadCount: 0,
      myLastReadSeq: 0,
      pinned: false,
      muted: false,
      snoozed: false,
    }) as ConversationListItem;

  function setMe(permissions: string[]) {
    useAuthStore.setState({
      user: {
        id: 'me',
        email: 'me@nodus.local',
        displayName: 'Я',
        permissions,
      },
    });
  }

  beforeEach(() => {
    vi.mocked(api).mockImplementation(async (url) => {
      if (String(url) === '/chat/conversations') {
        return { items: [currentConv], nextCursor: null, lastSeq: 0 };
      }
      return { items: [], nextCursor: null, lastSeq: 0 };
    });
  });

  let currentConv: ConversationListItem = conv('member');

  afterEach(() => {
    cleanup();
    queryClient.clear();
    useAuthStore.setState({ user: null });
  });

  async function openForeign() {
    render(
      <QueryClientProvider client={queryClient}>
        <MessageMenu
          message={msg({ author: { id: 'u1', displayName: 'Чужой', avatarUrl: null } })}
          mine={false}
          conversationId="conv-1"
          scope="conversation:conv-1"
        >
          <span data-slot="bubble-content">пузырь</span>
        </MessageMenu>
      </QueryClientProvider>,
    );
    const bubble = screen.getByText('пузырь');
    fireEvent.contextMenu(bubble, { button: 2, clientX: 10, clientY: 10 });
    await screen.findByRole('menuitem', { name: ui.chat.menu.copy });
  }

  it('админ беседы видит «Удалить» на чужом в группе', async () => {
    currentConv = conv('admin');
    setMe([]);
    await openForeign();
    // Право приезжает асинхронно (запрос списка бесед) — ждём рендера.
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: ui.chat.menu.delete })).toBeTruthy(),
    );
  });

  it('модератор портала (chat.moderate) — в канале', async () => {
    currentConv = conv('member', 'project_channel');
    setMe(['chat.moderate']);
    await openForeign();
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: ui.chat.menu.delete })).toBeTruthy(),
    );
  });

  it('обычный участник — «Удалить» на чужом нет', async () => {
    currentConv = conv('member');
    setMe([]);
    await openForeign();
    expect(screen.queryByRole('menuitem', { name: ui.chat.menu.delete })).toBeNull();
  });

  it('модератору запрещено вне групп/каналов (direct)', async () => {
    currentConv = conv('member', 'direct');
    setMe(['chat.moderate']);
    await openForeign();
    expect(screen.queryByRole('menuitem', { name: ui.chat.menu.delete })).toBeNull();
  });
});

describe('MessageMenu: поверхность стикера (#288)', () => {
  it('ПКМ по глифу стикера в плите тела открывает меню (data-slot сменился — гейт обязан знать новые)', async () => {
    // Регресс полной ui-валидации #288: плита стикера переехала на тело
    // «цитата+глиф» — allow-список onSurface без новых слотов глушил ПКМ.
    render(
      <QueryClientProvider client={queryClient}>
        <MessageMenu
          message={msg()}
          mine={false}
          conversationId="conv-1"
          scope="conversation:conv-1"
        >
          <span data-slot="sticker-body">
            <button type="button" data-slot="sticker-glyph">
              глиф
            </button>
          </span>
        </MessageMenu>
      </QueryClientProvider>,
    );
    fireEvent.contextMenu(screen.getByText('глиф'), { button: 2, clientX: 10, clientY: 10 });
    await screen.findByRole('menuitem', { name: ui.chat.menu.copy });
  });

  it('ПКМ мимо поверхностей сообщение не открывает (как раньше)', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MessageMenu
          message={msg()}
          mine={false}
          conversationId="conv-1"
          scope="conversation:conv-1"
        >
          <span data-slot="sticker-body">
            <button type="button" data-slot="sticker-glyph">
              глиф
            </button>
          </span>
          <span data-slot="sticker-meta">мета</span>
        </MessageMenu>
      </QueryClientProvider>,
    );
    // Мета-строка снаружи плиты — поверхности нет: меню не собирается.
    fireEvent.contextMenu(screen.getByText('мета'), { button: 2, clientX: 10, clientY: 10 });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
