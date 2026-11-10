// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationListItem } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { chatKeys } from './chat-keys.js';
import { ConversationViewsLine } from './views-line.js';

/** Строка просмотров над композером (#102 раунд 2): одна строка на беседу для
 *  СВОЕГО последнего сообщения; группы — «Имя и ещё N» с попапом, direct —
 *  «дата, время»; не просмотрено / нет своих — строки нет. */
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const conv = (type: 'group' | 'direct'): ConversationListItem =>
  ({
    id: 'conv-1',
    type,
    title: null,
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
    membersPreview: [
      { id: 'me', displayName: 'Я', avatarUrl: null },
      { id: 'u1', displayName: 'Анна Первая', avatarUrl: null },
      { id: 'u2', displayName: 'Борис Второй', avatarUrl: null },
    ],
    lastMessage: null,
    unreadCount: 0,
    myLastReadSeq: 0,
    pinned: false,
    muted: false,
    snoozed: false,
  }) as ConversationListItem;

const msg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  conversationId: 'conv-1',
  seq: 1,
  clientMessageId: 'client-1',
  author: { id: 'me', displayName: 'Я', avatarUrl: null },
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
  createdAt: '2026-09-25T10:00:00Z',
  ...overrides,
});

function renderLine(type: 'group' | 'direct', messages: ChatMessage[]) {
  queryClient.setQueryData(chatKeys.conversations(), {
    items: [conv(type)],
    nextCursor: null,
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConversationViewsLine conversationId="conv-1" messages={messages} />
    </QueryClientProvider>,
  );
}

describe('ConversationViewsLine (#102 раунд 2)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'me', email: 'me@test.nodus', displayName: 'Я', permissions: [] },
    });
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('группа: просмотрено → «Имя» + «и ещё N» для последнего своего', () => {
    renderLine('group', [
      msg({
        id: 'm0',
        seq: 1,
        readBy: [{ id: 'u1', displayName: 'Анна Первая', avatarUrl: null }],
      }),
      msg({
        id: 'm1',
        seq: 2,
        readBy: [
          { id: 'u1', displayName: 'Анна Первая', avatarUrl: null },
          { id: 'u2', displayName: 'Борис Второй', avatarUrl: null },
        ],
      }),
    ]);
    // Строка — по ПОСЛЕДНЕМУ своему: 2 посмотревших → «и ещё 1»; союз «и» —
    // вне подчёркнутой кнопки (#132 р.2).
    expect(screen.getByText('Просмотрено:')).toBeTruthy();
    expect(screen.getByText('Анна Первая')).toBeTruthy();
    expect(screen.getByText('ещё 1')).toBeTruthy();
    expect(screen.getByText('и', { exact: true })).toBeTruthy();
  });

  it('пачка C: «ещё N» открывает ТОЛЬКО остальных — названный не дублируется', () => {
    renderLine('group', [
      msg({
        id: 'm1',
        seq: 1,
        readBy: [
          { id: 'u1', displayName: 'Анна Первая', avatarUrl: null },
          { id: 'u2', displayName: 'Борис Второй', avatarUrl: null },
          { id: 'u3', displayName: 'Вера Третья', avatarUrl: null },
        ],
      }),
    ]);
    // Названа Анна → «ещё 2» = Борис и Вера; попап «ещё» — БЕЗ Анны.
    const more = screen.getByText('ещё 2');
    fireEvent.click(more);
    // Попап в портале: строки остальных есть, названной Анны — нет.
    expect(screen.getAllByText('Борис Второй').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Вера Третья').length).toBeGreaterThan(0);
    const popup = document.querySelector('[data-slot="views-popup"]');
    expect(popup?.textContent).not.toContain('Анна Первая');
  });

  it('direct: просмотрено → «Просмотрено: {дата}, {время}» без имён', () => {
    // Дата — ДИНАМИЧЕСКАЯ (текущий момент): хардкод «сегодня» был бомбой
    // замедленного действия (тест писался 25.09 и сломался сам собой 27.09);
    // «сейчас» всегда сегодня в локальной зоне — формат строки и проверяем.
    const readAt = new Date().toISOString();
    renderLine('direct', [msg({ readAt })]);
    // Время — в локальной зоне хоста: проверяем формат, не конкретный час.
    expect(screen.getByText(/Просмотрено: (сегодня|Сегодня), \d{2}:\d{2}/u)).toBeTruthy();
  });

  it('не просмотрено / нет своих / удалённое последнее — текста нет; резерв высоты держится (#132)', () => {
    const { rerender, container } = renderLine('group', [msg({ readBy: [] })]);
    expect(screen.queryByText('Просмотрено:')).toBeNull();
    // Квитанции ещё нет — невидимый слот той же геометрии: стена не двигается.
    expect(container.querySelector('[data-slot="views-reserved"]')).not.toBeNull();
    rerender(
      <QueryClientProvider client={queryClient}>
        <ConversationViewsLine
          conversationId="conv-1"
          messages={[msg({ deletedAt: '2026-09-25T10:00:00Z', readBy: [] })]}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Просмотрено:')).toBeNull();
    rerender(
      <QueryClientProvider client={queryClient}>
        <ConversationViewsLine
          conversationId="conv-1"
          messages={[msg({ author: { id: 'u1', displayName: 'Анна', avatarUrl: null } })]}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Просмотрено:')).toBeNull();
    // Своих сообщений нет — резерва нет (метка невозможна).
    expect(container.querySelector('[data-slot="views-reserved"]')).toBeNull();
  });

  it('автор нижнего сообщения ленты НЕ показывается в метке (вердикт р.4)', () => {
    // Своё последнее прочитал u1; ниже висит чужое сообщение от u1 — метка
    // под ним не должна показывать u1 («автор прочитал своё»); зрителей нет —
    // метки нет вовсе.
    renderLine('group', [
      msg({
        id: 'm0',
        seq: 1,
        readBy: [{ id: 'u1', displayName: 'Анна Первая', avatarUrl: null }],
      }),
      msg({
        id: 'm1',
        seq: 2,
        author: { id: 'u1', displayName: 'Анна Первая', avatarUrl: null },
      }),
    ]);
    expect(screen.queryByText('Просмотрено:')).toBeNull();
  });
});
