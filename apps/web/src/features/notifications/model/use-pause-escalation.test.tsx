// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { notificationsKeys } from '../../../shared/notifications-keys.js';
import { IDLE_TRIGGER_MS, usePauseEscalation } from './use-pause-escalation.js';
import { useNotificationsToastStore } from './toast-store.js';

const ME = '22222222-2222-4222-8222-222222222222';

vi.mock('../../../shared/auth-store.js', () => ({
  useAuthStore: { getState: () => ({ user: { id: ME } }) },
}));
vi.mock('../../../shared/chat/notifications.js', () => ({
  getOpenConversation: () => null,
}));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: '/home' } }),
}));

describe('usePauseEscalation: сводная волна «Требуют внимания»', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotificationsToastStore.setState({
      personal: [],
      actions: { count: 0, latest: null },
      mutedConversations: new Set(),
      snoozedConversations: new Set(),
      dnd: { enabled: false, start: '22:00', end: '08:00' },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('после 30 с простоя показывает одну сводную карточку с реальным получателем', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(notificationsKeys.summary(), {
      attention: 3,
      urgent: 0,
      high: 3,
      medium: 0,
      low: 0,
    });

    renderHook(() => usePauseEscalation(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    act(() => {
      vi.advanceTimersByTime(IDLE_TRIGGER_MS);
    });

    const { actions } = useNotificationsToastStore.getState();
    expect(actions.count).toBe(1);
    expect(actions.latest?.userId).toBe(ME);
  });
});
