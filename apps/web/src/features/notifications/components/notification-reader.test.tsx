// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Notification, NotificationPage } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { useNotificationDetailStore } from '../model/detail-store.js';
import { NotificationReader } from './notification-reader.js';

// #533: статические импорты — Vite-transform не входит в бюджет testTimeout.
// vi.mock хоистится выше импортов (Vitest docs), фабрики применяются и к ним.
vi.mock('../../../app/router.js', () => ({
  router: { state: { location: { pathname: '/home' } }, navigate: vi.fn() },
}));
vi.mock('../../../app/shell/use-card-stack.js', () => ({
  useOpenCard: () => vi.fn(),
}));
vi.mock('../../../shared/api-client.js', () => ({
  api: vi.fn(),
}));

/** #244: просмотр = прочтение — открытие карточки сразу гасит уведомление
 *  (POST /read уходит сам, без кнопки «Прочитать»), карточка остаётся
 *  открытой, «Перейти к источнику» на месте. */
describe('NotificationReader: авто-прочтение при открытии', () => {
  it('открытие непрочитанного шлёт read один раз; кнопки «Прочитать» нет, переход есть', async () => {
    const item: Notification = {
      id: '11111111-1111-4111-8111-111111111111',
      seq: 5,
      priority: 'high',
      kind: 'chat.mention',
      sourceType: 'message',
      sourceId: '22222222-2222-4222-8222-222222222222',
      actor: { id: 'u1', displayName: 'Анна', avatarUrl: null },
      preview: 'Упоминание в беседе',
      urgentText: null,
      conversationId: '33333333-3333-4333-8333-333333333333',
      conversationTitle: 'Проект А',
      messageId: '44444444-4444-4444-8444-444444444444',
      threadRootId: null,
      createdAt: new Date().toISOString(),
      readAt: null,
      ackAt: null,
    };
    const page = (): NotificationPage => ({ items: [item], nextCursor: null, lastSeq: item.seq });

    vi.mocked(api).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.endsWith('/read')) {
        item.readAt = new Date().toISOString();
        return item;
      }
      return page();
    });

    useNotificationDetailStore.getState().open(item.id);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    render(<NotificationReader />, { wrapper });

    // Read ушёл сам — ровно один вызов на открытие (рефетчи его не множат).
    await waitFor(() => {
      const reads = vi.mocked(api).mock.calls.filter(([url]) => String(url).endsWith('/read'));
      expect(reads).toHaveLength(1);
    });
    // Кнопки «Прочитать» больше нет; переход к источнику остался.
    expect(screen.queryByText('Прочитать')).toBeNull();
    expect(screen.getByRole('button', { name: 'Перейти к источнику' })).toBeTruthy();
    // Карточка не закрылась сама: превью текста на экране.
    expect(screen.getByText('Упоминание в беседе')).toBeTruthy();
  });
});
