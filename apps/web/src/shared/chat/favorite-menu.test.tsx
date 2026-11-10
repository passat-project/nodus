// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FavoriteCard } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

vi.mock('../api-client.js', () => ({
  api: vi.fn(),
}));

import { FavoriteMenu } from './favorite-menu.js';
import { useForwardDialog } from './dialog-stores.js';
import { useSelectionStore } from './selection-store.js';

/** #237: окно-источник «Избранного» — выбор и Telegram-набор батч-команд
 *  у карточек: пересылка ОРИГИНАЛОВ из беседы-источника, батч «снять
 *  звёзды», копирование, отмена. Витрина (без scope) — прежнее меню без
 *  селекта. */
const card = (overrides: Partial<FavoriteCard> = {}): FavoriteCard => ({
  messageId: 'orig-1',
  conversationId: 'src-conv',
  conversationTitle: 'Беседа-источник',
  conversationType: 'group',
  threadRootId: null,
  author: { id: 'u1', displayName: 'Анна', avatarUrl: null },
  text: 'сообщение-оригинал',
  attachments: [],
  editedAt: null,
  deletedAt: null,
  urgent: false,
  obliterated: false,
  createdAt: '2026-10-07T09:00:00.000Z',
  labels: [],
  favoritedAt: '2026-10-07T09:00:00.000Z',
  ...overrides,
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderMenu(props: { scope?: string; selectionActive?: boolean }) {
  return render(
    <QueryClientProvider client={queryClient}>
      <FavoriteMenu card={card()} scope={props.scope} selectionActive={props.selectionActive}>
        <span data-slot="bubble-content">пузырь</span>
      </FavoriteMenu>
    </QueryClientProvider>,
  );
}

function openMenu() {
  const bubble = screen.getByText('пузырь');
  fireEvent.contextMenu(bubble, { button: 2, clientX: 10, clientY: 10 });
  return screen.findByRole('menuitem', { name: ui.chat.showInChat });
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  useSelectionStore.getState().exit();
  useForwardDialog.getState().close();
});

describe('FavoriteMenu: окно-источник «Избранного» (#237)', () => {
  it('витрина (без scope): «Выбрать» нет — прежнее меню', async () => {
    renderMenu({});
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: ui.chat.menu.select })).toBeNull();
    expect(screen.getByRole('menuitem', { name: ui.chat.unfavorite })).toBeTruthy();
  });

  it('окно-источник: «Выбрать» появляется', async () => {
    renderMenu({ scope: 'notes-source:src-conv' });
    await openMenu();
    expect(screen.getByRole('menuitem', { name: ui.chat.menu.select })).toBeTruthy();
  });

  it('режим селекта: батч-набор; пересылка — оригиналы из беседы-источника', async () => {
    useSelectionStore.getState().enter('notes-source:src-conv', 'orig-1');
    useSelectionStore.getState().toggle('notes-source:src-conv', 'orig-2', false);
    renderMenu({ scope: 'notes-source:src-conv', selectionActive: true });

    const bubble = screen.getByText('пузырь');
    fireEvent.contextMenu(bubble, { button: 2, clientX: 10, clientY: 10 });
    await screen.findByRole('menuitem', { name: ui.chat.forwardSelected });

    // Одиночных команд нет — только батч-набор.
    expect(screen.queryByRole('menuitem', { name: ui.chat.showInChat })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: ui.chat.unfavorite })).toBeNull();
    expect(screen.getByRole('menuitem', { name: ui.chat.unfavoriteSelected })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: ui.chat.copySelected })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: ui.chat.clearSelection })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: ui.chat.forwardSelected }));
    await waitFor(() => {
      expect(useForwardDialog.getState().request).toEqual({
        sourceConversationId: 'src-conv',
        messageIds: ['orig-1', 'orig-2'],
      });
    });
  });

  it('батч «убрать из избранного»: мутация на каждый id + выход из селекта', async () => {
    useSelectionStore.getState().enter('notes-source:src-conv', 'orig-1');
    renderMenu({ scope: 'notes-source:src-conv', selectionActive: true });

    const bubble = screen.getByText('пузырь');
    fireEvent.contextMenu(bubble, { button: 2, clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole('menuitem', { name: ui.chat.unfavoriteSelected }));

    const { api } = await import('../api-client.js');
    await waitFor(() => {
      const calls = vi
        .mocked(api)
        .mock.calls.filter(([url]) => String(url) === '/chat/favorites/orig-1');
      expect(calls).toHaveLength(1);
    });
    expect(useSelectionStore.getState().scope).toBeNull();
  });
});
