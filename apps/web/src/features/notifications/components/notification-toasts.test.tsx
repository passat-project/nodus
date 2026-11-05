// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useNotificationsToastStore } from '../model/toast-store.js';
import { NotificationToasts } from './notification-toasts.js';

// Реальный router.tsx (втянут через open-notification) строит дерево маршрутов
// на импорте — мокаем как notification-reader.test; useNavigate — точечно,
// остальная библиотека настоящая (паттерн reader-теста).
vi.mock('../../../app/router.js', () => ({
  router: { state: { location: { pathname: '/home' } }, navigate: vi.fn() },
}));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../../app/shell/use-card-stack.js', () => ({ useOpenCard: () => vi.fn() }));
vi.mock('../../../shared/chat/chat-queries.js', () => ({
  useConversations: () => ({ data: { items: [] } }),
}));
vi.mock('../model/use-pause-escalation.js', () => ({ usePauseEscalation: () => undefined }));

// Сводка журнала — единственный источник внимания (#616): данные теста.
const summary = vi.hoisted(() => ({ attention: 1 }));
vi.mock('../api/notifications-api.js', () => ({
  useNotificationSummary: () => ({ data: summary }),
}));

function mountToasts(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<NotificationToasts />, { wrapper });
}

/** #616: сводная «Требуют внимания» следует журналу — внимание угасло,
 *  карточка гаснет сама (раньше локальный счётчик висел бесконечно). */
describe('NotificationToasts: сводная следует журналу (#616)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationsToastStore.setState({
      personal: [],
      actions: { count: 1, latest: null },
      mutedConversations: new Set<string>(),
      snoozedConversations: new Set<string>(),
      dnd: { enabled: false, start: '22:00', end: '08:00' },
    });
  });

  it('attention 0 — карточка «Требуют внимания» исчезает сама', async () => {
    summary.attention = 0;
    mountToasts();
    await waitFor(() => {
      expect(useNotificationsToastStore.getState().actions.count).toBe(0);
    });
  });

  it('attention > 0 — карточка остаётся, синк получил значение сводки', async () => {
    summary.attention = 2;
    const syncSpy = vi.spyOn(useNotificationsToastStore.getState(), 'syncWithAttention');
    mountToasts();
    await waitFor(() => {
      expect(syncSpy).toHaveBeenCalledWith(2);
    });
    expect(useNotificationsToastStore.getState().actions.count).toBe(1);
  });
});
