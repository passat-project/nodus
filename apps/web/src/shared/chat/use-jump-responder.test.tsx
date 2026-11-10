// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api-client.js';
import { chatKeys } from './chat-keys.js';
import type { HistoryPage } from './feed-merge.js';
import { useFlashStore, useJumpStore } from './jump-store.js';
import { JumpResponder } from './use-jump-responder.js';
import { revealMessage } from './scroll-jump.js';

vi.mock('../api-client.js', () => ({ api: vi.fn() }));
vi.mock('./scroll-jump.js', () => ({ revealMessage: vi.fn() }));

/**
 * Бэкфилл прыжка (#307): цель старее загруженного окна — резидент догружает
 * историю страницу за страницей (эффект перезапускается на выросшем кэше),
 * найдя цель — reveal+вспышка+consume; исчерпание — тост «не найдено».
 */

const CONV = '11111111-1111-4111-8111-111111111111';

const m = (id: string, seq: number) => ({
  id,
  conversationId: CONV,
  seq,
  clientMessageId: id,
  author: { id: 'u1', displayName: 'Автор', avatarUrl: null },
  text: `текст ${id}`,
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
  createdAt: '2026-10-07T10:00:00Z',
});

function mount(client: QueryClient, viewport: HTMLElement, itemCount: number) {
  render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(JumpResponder, {
        conversationId: CONV,
        threadRootId: null,
        itemCount,
        containerRef: { current: viewport },
      }) as ReactNode,
    ),
  );
}

describe('useJumpResponder — бэкфилл истории (#307)', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(revealMessage).mockReset();
    useJumpStore.setState({ target: null });
    useFlashStore.setState({ messageId: null });
  });
  afterEach(() => {
    // Явный клин: автоклиана RTL нет (vitest без globals) — без него деревья
    // прошлых тестов остаются смонтированными и их резиденты едят target.
    cleanup();
    document.body.innerHTML = '';
  });

  it('цель старее окна: догружает страницу, на выросшем кэше — reveal+вспышка', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<HistoryPage>(chatKeys.messages(CONV), {
      items: [m('new', 100)],
      nextCursor: 'cur-99',
    });
    vi.mocked(api).mockResolvedValue({ items: [m('old-target', 40)], nextCursor: null });

    const viewport = document.createElement('div');
    document.body.append(viewport);
    mount(client, viewport, 1);
    act(() => {
      useJumpStore.getState().request(CONV, 'old-target', null);
    });
    // Бэкфилл пошёл; лента «отрендерила» выросший кэш — цель появилась в DOM.
    await act(async () => {
      await vi.waitFor(() =>
        expect(client.getQueryData<HistoryPage>(chatKeys.messages(CONV))?.items).toHaveLength(2),
      );
      const el = document.createElement('div');
      el.dataset.messageId = 'old-target';
      viewport.append(el);
    });
    // Перезапуск эффекта имитируется сменой itemCount (лента перерисовалась).
    mount(client, viewport, 2);

    await vi.waitFor(() => expect(revealMessage).toHaveBeenCalled());
    expect(useFlashStore.getState().messageId).toBe('old-target');
    expect(useJumpStore.getState().target).toBeNull();
    expect(vi.mocked(api).mock.calls[0]?.[0]).toContain('cursor=cur-99');
  });

  it('исчерпание истории без цели — тост «не найдено» и consume', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<HistoryPage>(chatKeys.messages(CONV), {
      items: [m('new', 100)],
      nextCursor: 'cur-99',
    });
    // Страница пуста и границы больше нет — расти кэшу нечем.
    vi.mocked(api).mockResolvedValue({ items: [], nextCursor: null });

    const viewport = document.createElement('div');
    document.body.append(viewport);
    mount(client, viewport, 1);
    act(() => {
      useJumpStore.getState().request(CONV, 'missing', null);
    });

    await vi.waitFor(() => expect(useJumpStore.getState().target).toBeNull());
    // ensureOlderPage вернул false (пустая страница) — тост без повторов.
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
  });
});
