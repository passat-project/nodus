// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui, type ConversationListItem } from '@nodus/contracts';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConversationLevel } from './forward-dialog.js';

/**
 * #956: поиск в пикере пересылки — серверный. Раньше диалог фильтровал
 * первые 50 загруженных бесед на клиенте: получатель за пределами страницы
 * был недостижим. Теперь строка ищет по всей выдаче, а клиент оставляет
 * только фильтр категорий.
 */

const { searchMock, searchState } = vi.hoisted(() => ({
  searchMock: vi.fn(() => ({
    data: searchState.pending ? undefined : { items: searchState.items },
  })),
  searchState: { items: [] as ConversationListItem[], pending: false },
}));

vi.mock('@nodus/ui/components/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@nodus/ui/components/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));
vi.mock('./chat-queries.js', () => ({
  useConversations: () => ({ data: { items: [] } }),
  useConversationMessages: () => ({ data: { items: [] } }),
  useConversationSearch: searchMock,
}));
vi.mock('../lib/use-debounced-value.js', () => ({
  useDebouncedValue: (value: string) => value,
}));
vi.mock('./conversation-avatar.js', () => ({ ConversationAvatar: () => null }));
vi.mock('./conversations.js', () => ({
  conversationTitle: (conversation: ConversationListItem) => conversation.title ?? 'Чат',
  conversationSubtitle: () => 'подзаголовок',
  isNotesConversation: (conversation: ConversationListItem) => conversation.id === 'notes',
  sortByActivity: (items: ConversationListItem[]) => items,
}));

function conversation(id: string, title: string): ConversationListItem {
  return {
    id,
    type: 'group',
    title,
    avatarUrl: null,
    myRole: 'member',
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
  };
}

afterEach(() => {
  cleanup();
  searchState.items = [];
  searchState.pending = false;
  searchMock.mockClear();
});

describe('ConversationLevel — серверный поиск пикера пересылки (#956)', () => {
  it('строка ищет по всей выдаче: серверные строки заменяют загруженную страницу', () => {
    const onPick = vi.fn();
    searchState.items = [conversation('c-2', 'Смета проекта')];

    render(
      <ConversationLevel
        conversations={[conversation('c-1', 'Общий чат')]}
        meId="me"
        onPick={onPick}
        onDrill={vi.fn()}
      />,
    );
    expect(screen.getByText('Общий чат')).not.toBeNull();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'смета' } });

    expect(searchMock).toHaveBeenCalledWith('смета');
    expect(screen.getByText('Смета проекта')).not.toBeNull();
    // Серверная выдача — источник строк: загруженная страница не подмешивается.
    expect(screen.queryByText('Общий чат')).toBeNull();
  });

  it('пустой запрос показывает список бесед без обращения к серверу', () => {
    render(
      <ConversationLevel
        conversations={[conversation('c-1', 'Общий чат')]}
        meId="me"
        onPick={vi.fn()}
        onDrill={vi.fn()}
      />,
    );

    expect(searchMock).toHaveBeenCalledWith('');
    expect(screen.getByText('Общий чат')).not.toBeNull();
  });

  it('«Избранное» остаётся первой строкой при поиске и не дублируется', () => {
    searchState.items = [conversation('notes', 'Избранное'), conversation('c-2', 'Смета проекта')];

    render(
      <ConversationLevel
        conversations={[conversation('notes', 'Избранное'), conversation('c-1', 'Общий чат')]}
        meId="me"
        onPick={vi.fn()}
        onDrill={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'смета' } });

    expect(screen.getAllByText('Избранное')).toHaveLength(1);
    expect(screen.getByText('Смета проекта')).not.toBeNull();
  });

  it('до первого ответа сервера показывает загруженный список, а не «ничего не найдено»', () => {
    searchState.pending = true;

    render(
      <ConversationLevel
        conversations={[conversation('c-1', 'Общий чат')]}
        meId="me"
        onPick={vi.fn()}
        onDrill={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'смета' } });

    expect(screen.getByText('Общий чат')).not.toBeNull();
    expect(screen.queryByText(ui.chat.forwardEmpty)).toBeNull();
  });
});
