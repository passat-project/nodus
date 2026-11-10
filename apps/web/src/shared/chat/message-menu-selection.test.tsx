// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

vi.mock('../api-client.js', () => ({
  api: vi.fn(async () => ({ items: [], nextCursor: null, lastSeq: 0 })),
}));

import { MessageMenu } from './message-menu.js';
import { MessageRow } from './message-row.js';
import { useDeleteDialog, useForwardDialog } from './dialog-stores.js';
import { useSelectionStore } from './selection-store.js';

/** Repro фидбека владельца 10.10: в режиме мультиселекта ПКМ-команды
 *  «не работают, клик по команде снимает выделение пузыря под ней».
 *  Гипотеза: клик по пункту меню не доходит до обработчика. Проверяем
 *  полный путь: селект в сторе → ПКМ → клик по «Удалить выделенные» →
 *  запрос в delete-dialog. */
const msg = (id: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversationId: 'conv-1',
  seq: Number(id.replace('m', '')),
  clientMessageId: `client-${id}`,
  author: { id: 'u1', displayName: 'Чужой', avatarUrl: null },
  text: `текст ${id}`,
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
  createdAt: '2026-10-10T09:00:00.000Z',
  ...overrides,
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const toggles: string[] = [];

/** Реальное дерево: MessageRow (capture-глотатель селекта) ОБЕРТАЕТ меню —
 *  Radix портал контента является React-потомком строки: клики по пунктам
 *  всплывают через React-дерево в capture строки. */
function renderMenu(items: ChatMessage[], inRow: boolean) {
  const menu = (
    <MessageMenu
      message={items[0]!}
      mine={false}
      conversationId="conv-1"
      scope="conversation:conv-1"
      messagesOfSelection={() => items}
    >
      <span data-slot="bubble-content">пузырь</span>
    </MessageMenu>
  );
  return render(
    <QueryClientProvider client={queryClient}>
      {inRow ? (
        <MessageRow
          messageId={items[0]!.id}
          selectionKey={items[0]!.clientMessageId}
          selectable
          selected
          onToggle={() => toggles.push(items[0]!.clientMessageId)}
        >
          {menu}
        </MessageRow>
      ) : (
        menu
      )}
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  useSelectionStore.getState().exit();
  useDeleteDialog.getState().close();
  useForwardDialog.getState().close();
});

describe('MessageMenu: батч-команды в режиме селекта (repro #243)', () => {
  it('«Удалить выделенные» открывает диалог удаления с реальными id', async () => {
    const items = [msg('m1'), msg('m2')];
    useSelectionStore.getState().enter('conversation:conv-1', 'client-m1');
    useSelectionStore.getState().toggle('conversation:conv-1', 'client-m2', false);
    renderMenu(items, true);

    fireEvent.contextMenu(screen.getByText('пузырь'), { button: 2, clientX: 10, clientY: 10 });
    const item = await screen.findByRole('menuitem', { name: ui.chat.deleteSelected });
    expect(item.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(item);

    // Глотатель строки НЕ должен съесть клик по пункту меню (repro).
    expect(toggles).toEqual([]);
    await waitFor(() => {
      expect(useDeleteDialog.getState().request).toEqual({
        conversationId: 'conv-1',
        messageIds: ['m1', 'm2'],
      });
    });
  });

  it('контроль: клик ПО СТРОКЕ (не по меню) по-прежнему переключает выделение', async () => {
    const items = [msg('m1')];
    useSelectionStore.getState().enter('conversation:conv-1', 'client-m1');
    renderMenu(items, true);

    fireEvent.click(screen.getByText('пузырь'));
    expect(toggles).toEqual(['client-m1']);
  });

  it('«Переслать выделенные» открывает forward-диалог', async () => {
    const items = [msg('m1')];
    useSelectionStore.getState().enter('conversation:conv-1', 'client-m1');
    renderMenu(items, true);

    fireEvent.contextMenu(screen.getByText('пузырь'), { button: 2, clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.chat.forwardSelected }));

    await waitFor(() => {
      expect(useForwardDialog.getState().request).toEqual({
        sourceConversationId: 'conv-1',
        messageIds: ['m1'],
      });
    });
  });
});
