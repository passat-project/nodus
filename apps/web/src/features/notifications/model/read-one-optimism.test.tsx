// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Notification, NotificationPage, NotificationSummary } from '@nodus/contracts';

vi.mock('../../../shared/api-client.js', () => ({
  api: vi.fn(),
}));

/** G5/I4: оптимистичность «Прочитать» — детерминированный тест (deferred):
 * строка уходит из живых фильтров и сводки ДО ответа сервера, но ОСТАЁТСЯ
 * в истории 'all' (ридер держит открытую запись); reject → откат по снапшоту. */
describe('read-one оптимистичность', () => {
  it('строка ушла из фильтра и сводки до ответа; история и откат целы', async () => {
    const item: Notification = {
      id: '11111111-1111-4111-8111-111111111111',
      seq: 5,
      priority: 'high',
      kind: 'action.assignment',
      sourceType: 'task',
      sourceId: '22222222-2222-4222-8222-222222222222',
      actor: null,
      preview: 'Поручение: согласовать узел',
      urgentText: null,
      conversationId: null,
      conversationTitle: null,
      messageId: null,
      threadRootId: null,
      createdAt: new Date().toISOString(),
      readAt: null,
      ackAt: null,
    };
    const page = (items: Notification[]): NotificationPage => ({
      items,
      nextCursor: null,
      lastSeq: items.length > 0 ? items[0]!.seq : 0,
    });
    const summary: NotificationSummary = {
      urgent: 1,
      high: 2,
      medium: 1,
      low: 3,
      attention: 4,
    };

    const rejectRef: { fn: (error: unknown) => void } = { fn: () => {} };
    const promise = new Promise<Notification>((_resolve, reject) => {
      rejectRef.fn = reject;
    });
    const { api } = await import('../../../shared/api-client.js');
    vi.mocked(api).mockReturnValueOnce(promise);

    const { useReadNotification } = await import('../api/notifications-api.js');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['notifications', 'list', 'attention'], page([item]));
    queryClient.setQueryData(['notifications', 'list', 'all'], page([item]));
    queryClient.setQueryData(['notifications', 'summary'], summary);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useReadNotification(), { wrapper });
    await act(async () => {
      result.current.mutate(item.id);
    });

    // До ответа сервера: строка ушла из живого фильтра, счётчик приоритета -1…
    const attentionPage = queryClient.getQueryData<NotificationPage>([
      'notifications',
      'list',
      'attention',
    ])!;
    expect(attentionPage.items.some((n) => n.id === item.id)).toBe(false);
    const during = queryClient.getQueryData<NotificationSummary>(['notifications', 'summary'])!;
    expect(during.high).toBe(1);
    expect(during.attention).toBe(3);
    // …но история 'all' держит запись — ридер открыт и после гашения.
    const historyPage = queryClient.getQueryData<NotificationPage>([
      'notifications',
      'list',
      'all',
    ])!;
    expect(historyPage.items.some((n) => n.id === item.id)).toBe(true);

    rejectRef.fn(new Error('network'));
    await waitFor(() => {
      const after = queryClient.getQueryData<NotificationSummary>(['notifications', 'summary'])!;
      expect(after.high).toBe(2);
      expect(after.attention).toBe(4);
    });
    const restored = queryClient.getQueryData<NotificationPage>([
      'notifications',
      'list',
      'attention',
    ])!;
    expect(restored.items.some((n) => n.id === item.id)).toBe(true);
  });
});
