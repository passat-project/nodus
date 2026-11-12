// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { createElement, type ReactNode } from 'react';

import { useAuthStore } from '../../../shared/auth-store.js';
import { useTypingStore } from '../../../shared/socket/typing-store.js';
import { ConversationList } from './conversation-list.js';

/**
 * Список бесед (#96): ведущая группа закреплённых строк — в РАМКЕ (граница со
 * смещением от краёв списка, без заливки), сепараторы между строками (не на
 * всю ширину колонки) и внутри рамки тоже, у всех строк мягкий ховер.
 */

function conv(id: string, pinned = false): ConversationListItem {
  return {
    id,
    type: 'direct',
    title: id,
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
    pinned,
    muted: false,
    snoozed: false,
  };
}

const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const ME_REF = { id: ME, displayName: 'Я', avatarUrl: null };
const OTHER_REF = { id: OTHER, displayName: 'Коллега', avatarUrl: null };

function lastMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    seq: 1,
    clientMessageId: 'client-1',
    author: ME_REF,
    text: 'привет',
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
    createdAt: '2026-11-12T10:00:00Z',
    ...overrides,
  };
}

function row(id: string, overrides: Partial<ConversationListItem> = {}): ConversationListItem {
  return { ...conv(id), ...overrides };
}

function renderList(conversations: ConversationListItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return render(
    <ConversationList conversations={conversations} isLoading={false} onSelect={() => {}} />,
    {
      wrapper,
    },
  );
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: ME, displayName: 'Я', email: 'me@nodus.by', permissions: [] },
  });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null });
  useTypingStore.setState({ entries: {} });
});

describe('ConversationList — рамка закреплённых чатов (#96)', () => {
  it('закреплённые строки внутри [data-slot="pinned-chats"], остальные — вне', () => {
    const { container } = renderList([conv('plain-1'), conv('pinned-1', true), conv('plain-2')]);
    const area = container.querySelector('[data-slot="pinned-chats"]');
    expect(area).toBeTruthy();
    const inside = [...area!.querySelectorAll('button')].map((b) => b.textContent);
    expect(inside).toHaveLength(1);
    expect(inside[0]).toContain('pinned-1');
    const outside = [...container.querySelectorAll('button')].filter((b) => !area!.contains(b));
    expect(outside.map((b) => b.textContent?.includes('plain-'))).toEqual([true, true]);
  });

  it('без закреплённых области нет', () => {
    const { container } = renderList([conv('a'), conv('b')]);
    expect(container.querySelector('[data-slot="pinned-chats"]')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });
});

describe('ConversationList — сепараторы строк (#96, реф Битрикс24)', () => {
  it('между обычными строками hairline не на всю ширину, перед первой его нет', () => {
    const { container } = renderList([conv('a'), conv('b'), conv('c')]);
    const separators = [...container.querySelectorAll('[data-sep]')];
    expect(separators).toHaveLength(2);
    for (const sep of separators) {
      expect(sep.className).toContain('mx-4');
      expect(sep.className).toContain('border-t');
    }
  });

  it('внутри рамки закрепов сепараторы тоже есть (между закреплёнными)', () => {
    const { container } = renderList([conv('p1', true), conv('p2', true), conv('plain')]);
    const area = container.querySelector('[data-slot="pinned-chats"]')!;
    const inner = [...area.querySelectorAll('[data-sep]')];
    expect(inner).toHaveLength(1);
    expect(inner[0]!.className).toContain('mx-[calc(0.75rem-1px)]');
  });

  it('у всех строк мягкий (скруглённый) ховер, у закреплённых — по рамке', () => {
    const { container } = renderList([conv('p', true), conv('plain')]);
    for (const button of container.querySelectorAll('button')) {
      expect(button.className).toContain('rounded');
      expect(button.className).toContain('hover:bg-accent/40');
    }
    const area = container.querySelector('[data-slot="pinned-chats"]')!;
    const inside = area.querySelector('button')!;
    // ховер закреплённой строки = внутренняя область рамки: скругление =
    // внутренний радиус рамки (radius-xl минус граница)
    expect(inside.className).toContain('rounded-[calc(var(--radius-xl)-1px)]');
    // остальные строки — с тем же боковым зазором, что и рамка (mx-1)
    const outside = [...container.querySelectorAll('button')].filter((b) => !area.contains(b));
    expect(outside[0]!.className).toContain('mx-1');
  });
});

describe('метка последнего сообщения (#782, модель Битрикс24)', () => {
  const now = new Date();

  function lastMessage(createdAt: string): ChatMessage {
    return {
      id: 'm1',
      conversationId: 'conv',
      seq: 1,
      clientMessageId: 'm1',
      author: { id: 'u1', displayName: 'Иван Петров', avatarUrl: null },
      text: 'текст',
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
      createdAt,
    };
  }

  const withLast = (id: string, createdAt: string): ConversationListItem => ({
    ...conv(id),
    lastMessage: lastMessage(createdAt),
  });

  it('прошлый год — ДД.ММ.ГГГГ, вчера — «Вчера», сегодня — время', () => {
    const prevYear = now.getFullYear() - 1;
    const old = renderList([withLast('old', new Date(prevYear, 2, 3, 10, 0).toISOString())]);
    expect(old.getByText(`03.03.${prevYear}`)).toBeTruthy();

    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 10, 0);
    expect(renderList([withLast('y', y.toISOString())]).getByText('Вчера')).toBeTruthy();

    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5);
    expect(renderList([withLast('t', t.toISOString())]).getByText('09:05')).toBeTruthy();
  });

  it('метка не переносится и не сжимается (узкая колонка)', () => {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 5);
    const label = renderList([withLast('t', t.toISOString())]).getByText('09:05');
    expect(label.className).toContain('whitespace-nowrap');
    expect(label.className).toContain('shrink-0');
  });
});

describe('метка черновика в списке (вердикт 25.09, модель Telegram)', () => {
  it('красным — только слово «Черновик», текст метки — обычным цветом', () => {
    const withDraft: ConversationListItem = {
      ...conv('d1'),
      draft: { text: 'неотправленное сообщение', revision: 1, updatedAt: '2026-09-25T10:00:00Z' },
    };
    const view = renderList([withDraft]);
    const label = view.getByText('Черновик:', { exact: false });
    expect(label.className).toContain('text-destructive');
    const text = view.getByText('неотправленное сообщение');
    // Сам текст метки — НЕ красный (красным только слово).
    expect(text.closest('span')?.className).not.toContain('text-destructive');
  });
});

describe('галки отправлено/прочитано в строке списка (#799, модель Telegram)', () => {
  function ticks(view: ReturnType<typeof renderList>) {
    const button = view.getByRole('button');
    return {
      sent: within(button).queryByLabelText(ui.chat.sent),
      read: within(button).queryByLabelText(ui.chat.read),
    };
  }

  it('своё отправленное — одна галка, прочитанное — две', () => {
    const sent = renderList([row('sent', { lastMessage: lastMessage({ readAt: null }) })]);
    expect(ticks(sent).sent).not.toBeNull();
    expect(ticks(sent).read).toBeNull();
    sent.unmount();

    const read = renderList([
      row('read', { lastMessage: lastMessage({ readAt: '2026-11-12T10:05:00Z' }) }),
    ]);
    expect(ticks(read).read).not.toBeNull();
    expect(ticks(read).sent).toBeNull();
  });

  it('чужое последнее сообщение — без галок', () => {
    const view = renderList([
      row('foreign', {
        lastMessage: lastMessage({ author: OTHER_REF, readAt: '2026-11-12T10:05:00Z' }),
      }),
    ]);
    expect(ticks(view).sent).toBeNull();
    expect(ticks(view).read).toBeNull();
  });

  it('удалённое последнее сообщение — без галок', () => {
    const view = renderList([
      row('deleted', {
        lastMessage: lastMessage({
          deletedAt: '2026-11-12T10:06:00Z',
          readAt: '2026-11-12T10:05:00Z',
        }),
      }),
    ]);
    expect(ticks(view).sent).toBeNull();
    expect(ticks(view).read).toBeNull();
  });

  it('одиночная беседа/канал (я единственный участник) — без галок', () => {
    const view = renderList([
      row('solo-channel', {
        type: 'project_channel',
        title: 'Новости',
        membersCount: 1,
        lastMessage: lastMessage({ readAt: '2026-11-12T10:05:00Z' }),
      }),
    ]);
    expect(ticks(view).sent).toBeNull();
    expect(ticks(view).read).toBeNull();
  });

  it('«Заметки» (беседа с собой) — без галок', () => {
    const view = renderList([
      row('notes', {
        type: 'direct',
        membersPreview: [ME_REF],
        membersCount: 1,
        lastMessage: lastMessage({ readAt: '2026-11-12T10:05:00Z' }),
      }),
    ]);
    expect(ticks(view).sent).toBeNull();
    expect(ticks(view).read).toBeNull();
  });

  it('черновик — без галок', () => {
    const view = renderList([
      row('draft', {
        draft: { text: 'неотправленное', revision: 1, updatedAt: '2026-11-12T10:06:00Z' },
        lastMessage: lastMessage({ readAt: '2026-11-12T10:05:00Z' }),
      }),
    ]);
    expect(ticks(view).sent).toBeNull();
    expect(ticks(view).read).toBeNull();
  });

  it('«печатает…» не гасит галки последнего сообщения', () => {
    useTypingStore.setState({
      entries: { typing: { userId: OTHER, expiresAt: Date.now() + 60_000 } },
    });
    const view = renderList([
      row('typing', {
        membersPreview: [OTHER_REF],
        lastMessage: lastMessage({ readAt: '2026-11-12T10:05:00Z' }),
      }),
    ]);
    expect(view.getByText(ui.chat.typing)).toBeTruthy();
    expect(ticks(view).read).not.toBeNull();
  });
});
