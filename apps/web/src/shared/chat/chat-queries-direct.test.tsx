// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDirectConversation } from './chat-queries.js';

/**
 * Гейт личного диалога (#972): карточка сотрудника, открытая из мессенджера,
 * стартует «Задачами» и НЕ создаёт диалог (POST find-or-create — побочный
 * эффект, #343) до первого открытия вкладки «Чат». Без опций поведение
 * прежнее — запрос сразу (остальные потребители).
 */

const api = vi.hoisted(() => vi.fn());

vi.mock('../api-client.js', () => ({
  api,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number) {
      super('api error');
      this.status = status;
    }
  },
}));

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  api.mockReset();
  client.clear();
});

describe('useDirectConversation — гейт вкладки «Чат» (#972)', () => {
  it('enabled:false — POST не уходит; после открытия «Чата» — уходит', async () => {
    api.mockResolvedValue({ id: 'conv-1' });
    const { rerender, result } = renderHook(
      ({ enabled }: { enabled: boolean }) => useDirectConversation('user-1', { enabled }),
      { wrapper, initialProps: { enabled: false } },
    );

    // Просмотр профиля (стартовая вкладка «Задачи») диалог не создаёт.
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(api).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();

    // Первое открытие вкладки «Чат» — find-or-create.
    rerender({ enabled: true });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/chat/conversations/direct/user-1', { method: 'POST' }),
    );
    await waitFor(() => expect(result.current.data).toEqual({ id: 'conv-1' }));
  });

  it('без опций — запрос сразу (прежнее поведение потребителей)', async () => {
    api.mockResolvedValue({ id: 'conv-2' });
    const { result } = renderHook(() => useDirectConversation('user-2'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ id: 'conv-2' }));
    expect(api).toHaveBeenCalledTimes(1);
  });
});
