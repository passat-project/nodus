// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: undefined as
    | {
        onOpenConversation: (event: {
          conversationId: string;
          threadRootId?: string | null;
        }) => void;
      }
    | undefined,
  openOrFocusTab: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('./desktop-bridge.js', () => ({
  isDesktopShell: () => true,
  bindDesktopShellEvents: (handlers: typeof h.handlers) => {
    h.handlers = handlers;
    return () => {};
  },
}));
vi.mock('../chat/chat-queries.js', () => ({
  cachedConversation: () => ({ id: 'c-task', type: 'task' }),
}));
vi.mock('../lib/tab-bridge.js', () => ({ openOrFocusTab: h.openOrFocusTab }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => h.navigate }));

import { useDesktopBridge } from './use-desktop-bridge.js';

afterEach(() => {
  h.openOrFocusTab.mockReset();
  h.navigate.mockReset();
  h.handlers = undefined;
});

describe('useDesktopBridge — попап оболочки (#1062)', () => {
  it('адрес несёт вкладку задачи и тред, вкладка модуля активируется', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    renderHook(() => useDesktopBridge({ onOpenLetter: vi.fn() }), { wrapper });

    act(() => h.handlers!.onOpenConversation({ conversationId: 'c-task', threadRootId: 't-1' }));

    const url = '/chat/c-task?tab=tasks&thread=t-1';
    expect(h.openOrFocusTab).toHaveBeenCalledWith(url, '/chat');
    expect(h.navigate).toHaveBeenCalledWith({ href: url });
  });
});
