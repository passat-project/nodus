// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ConversationListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

vi.mock('../api-client.js', () => ({
  api: vi.fn(async () => ({ items: [], nextCursor: null, lastSeq: 0 })),
}));

import { ChatMessageItem } from './chat-message.js';
import { chatKeys } from './chat-keys.js';
import { MessageMenu } from './message-menu.js';
import { PostCard } from './post-card.js';
import { useChatDrafts } from './chat-drafts.js';
import { useSelectionStore } from './selection-store.js';

/**
 * #729: гейты скрытия язычка «Ответить». Язычок — вторая точка входа пункта
 * ПКМ-меню, но он есть только там, где ответ — ЦИТАТА в композер: каналы
 * (лента, пост, панель обсуждения), режим выделения, летящий темп, окно
 * «Избранного», системные строки и надгробия его не получают.
 */

const SCOPE = 'conversation:conv-1';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const msg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
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
  createdAt: '2026-11-11T09:00:00.000Z',
  ...overrides,
});

function replyButton(): HTMLElement {
  return screen.getByRole('button', { name: ui.chat.replyToMessage });
}

/** Беседа-владелец в кэше списка: тип решает «канал или чат» (#729). */
function seedConversation(type: ConversationListItem['type']) {
  queryClient.setQueryData(chatKeys.conversations(), {
    items: [
      {
        id: 'conv-1',
        type,
        title: 'Беседа',
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
        task: type === 'task' ? { id: 't1', title: 'Задача', key: 'NOD-1' } : null,
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
      } as ConversationListItem,
    ],
    nextCursor: null,
    lastSeq: 0,
  });
}

function renderBuffer({
  message,
  mine = false,
  replyMode,
  variant,
  hideReplyButton,
}: {
  message: ChatMessage;
  mine?: boolean;
  replyMode?: 'quote' | 'thread';
  variant?: 'source-window';
  hideReplyButton?: boolean;
}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MessageMenu
          message={message}
          mine={mine}
          conversationId="conv-1"
          scope={SCOPE}
          replyMode={replyMode}
          variant={variant}
          hideReplyButton={hideReplyButton}
        >
          <ChatMessageItem message={message} mine={mine} />
        </MessageMenu>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  useChatDrafts.setState({ drafts: {} });
  useSelectionStore.getState().exit();
});

describe('Язычок «Ответить» (#729): только там, где ответ — цитата', () => {
  it('чат (quote): клик ставит цитату этого сообщения в композер', () => {
    renderBuffer({ message: msg() });

    fireEvent.click(replyButton());

    expect(useChatDrafts.getState().drafts[SCOPE]?.reply?.messageId).toBe('m1');
  });

  it('канал (replyMode=thread): у пузыря язычка нет — ответ живёт в тредах', () => {
    // «Обсудить» уже раскрывает ту же панель тредов: вторая точка входа
    // дублировала бы её (вердикт админа 12.11.2026).
    renderBuffer({ message: msg({ threadRootId: 'root-9' }), replyMode: 'thread' });

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });

  it('тред канала (quote + hideReplyButton): язычка нет и внутри обсуждения', () => {
    renderBuffer({ message: msg({ threadRootId: 'root-9' }), hideReplyButton: true });

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });

  it('канал из кэша бесед: язычка нет, даже если хост не передал флаг', () => {
    seedConversation('project_channel');
    renderBuffer({ message: msg() });

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });

  it.each([
    ['личный', 'direct'],
    ['групповой', 'group'],
    ['чат задачи', 'task'],
    ['чат письма', 'letter'],
  ] as const)('%s чат: у чужого сообщения язычок есть', (_label, type) => {
    seedConversation(type);
    renderBuffer({ message: msg() });

    expect(replyButton()).toBeTruthy();
  });

  it.each([
    ['личном', 'direct'],
    ['групповом', 'group'],
    ['чате задачи', 'task'],
    ['чате письма', 'letter'],
  ] as const)('в %s чате у СВОЕГО сообщения язычка нет', (_label, type) => {
    // Вердикт владельца 13.11.2026: «ты же не можешь отвечать на свои».
    seedConversation(type);
    renderBuffer({ message: msg(), mine: true });

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });

  it('канал (replyMode=thread): у поста канала язычка нет', () => {
    const onOpenThread = vi.fn();
    const message = msg();
    render(
      <QueryClientProvider client={queryClient}>
        <MessageMenu
          message={message}
          mine={false}
          conversationId="conv-1"
          scope={SCOPE}
          replyMode="thread"
          onOpenThread={onOpenThread}
        >
          <PostCard
            message={message}
            mine={false}
            atEnd={false}
            showName
            repliesCount={0}
            participants={[]}
            lastReplyAt={null}
            threadUnread={false}
            reactionsHidden={false}
            onOpenThread={() => onOpenThread('m1')}
          />
        </MessageMenu>
      </QueryClientProvider>,
    );

    // Карточка канала — вообще без второй точки входа: ответ — «Обсудить».
    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
    expect(onOpenThread).not.toHaveBeenCalled();
  });
});

describe('Язычок «Ответить» (#729): когда его нет', () => {
  it('режим множественного выделения: действия «Ответить» нет', () => {
    const message = msg();
    useSelectionStore.getState().enter(SCOPE, message.clientMessageId);
    renderBuffer({ message });

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });

  it('летящий темп (seq=0): сервер не знает сообщение — язычка нет', () => {
    renderBuffer({ message: msg({ seq: 0, id: 'temp-1' }) });

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });

  it('окно-источник «Избранного» (source-window): в наборе нет ответа', () => {
    renderBuffer({ message: msg(), variant: 'source-window' });

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });

  it('строка без меню (системная): язычка нет', () => {
    const message = msg();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ChatMessageItem message={message} mine={false} />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });

  it('надгробие: даже с меню-провайдером действий нет — язычка нет', () => {
    // Строже хоста: пусть действие «Ответить» доступно в контексте — компонент
    // не должен рисовать язычок на удалённом сообщении.
    const deleted = msg({ deletedAt: '2026-11-12T09:00:00.000Z', text: '' });
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MessageMenu message={deleted} mine={false} conversationId="conv-1" scope={SCOPE}>
            <ChatMessageItem message={deleted} mine={false} />
          </MessageMenu>
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('button', { name: ui.chat.replyToMessage })).toBeNull();
  });
});
