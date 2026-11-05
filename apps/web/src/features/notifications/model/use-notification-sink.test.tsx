// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NotificationSnapshot } from '@nodus/contracts';

import { isDesktopShell } from '../../../shared/desktop/desktop-bridge.js';
import { notifyDesktopLetter } from '../../../shared/desktop/letter-popup.js';
import { notificationsKeys } from '../../../shared/notifications-keys.js';
import {
  registerNotificationSink,
  type NotificationSink,
} from '../../../shared/socket/notification-bridge.js';
import { useNotificationsToastStore } from './toast-store.js';
import { useNotificationSink } from './use-notification-sink.js';

vi.mock('../../../shared/desktop/desktop-bridge.js', () => ({
  isDesktopShell: vi.fn(),
}));
vi.mock('../../../shared/desktop/letter-popup.js', () => ({
  notifyDesktopLetter: vi.fn(),
}));
vi.mock('../../../shared/socket/notification-bridge.js', () => ({
  registerNotificationSink: vi.fn(),
}));
// Реальный push фильтрует свои же события и открытую беседу (как в toast-stack.test).
vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: { getState: () => ({ user: { id: ME } }) },
}));
vi.mock('../../../shared/chat/notifications.js', () => ({
  getOpenConversation: () => null,
}));

const ME = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';

function snap(n: number): NotificationSnapshot {
  return {
    notificationId: `n${n}`,
    userId: ME,
    priority: 'high',
    kind: 'chat.direct_message',
    sourceId: CONV,
    conversationId: CONV,
    conversationTitle: 'Беседа',
    messageId: `m${n}`,
    threadRootId: null,
    preview: `текст ${n}`,
    actorName: 'Автор',
  };
}

/** Синк, захваченный при монтировании хука (мост замокан). */
let sink: NotificationSink | null = null;

function mount(): { queryClient: QueryClient; unmount: () => void } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useNotificationSink(), { wrapper });
  return { queryClient, unmount: rendered.unmount };
}

/** Канал будил по контуру (#618): в оболочке — попапы, в браузере — тосты. */
describe('useNotificationSink: канал по контуру', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sink = null;
    vi.mocked(registerNotificationSink).mockImplementation((next) => {
      sink = next;
    });
    useNotificationsToastStore.setState({
      personal: [],
      actions: { count: 0, latest: null },
      mutedConversations: new Set<string>(),
      snoozedConversations: new Set<string>(),
      dnd: { enabled: false, start: '22:00', end: '08:00' },
    });
  });

  it('браузер: событие — личный тост + инвалидация сводки', async () => {
    vi.mocked(isDesktopShell).mockReturnValue(false);
    const { queryClient } = mount();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    sink?.dispatched(snap(1), 0);
    await waitFor(() => {
      expect(useNotificationsToastStore.getState().personal).toHaveLength(1);
    });
    expect(notifyDesktopLetter).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: notificationsKeys.summary() });
  });

  it('оболочка: событие — попап оболочки, внутренний тост не всплывает (#618)', () => {
    vi.mocked(isDesktopShell).mockReturnValue(true);
    mount();
    const event = snap(2);
    sink?.dispatched(event, 0);
    expect(notifyDesktopLetter).toHaveBeenCalledWith(event);
    expect(useNotificationsToastStore.getState().personal).toHaveLength(0);
  });

  it('размонтирование снимает синк', () => {
    const { unmount } = mount();
    unmount();
    expect(registerNotificationSink).toHaveBeenCalledWith(null);
  });
});
