// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { api } from '../api-client.js';
import { useConversationSearch, useScopedConversations } from './chat-queries.js';

vi.mock('../api-client.js', () => ({ api: vi.fn() }));

const apiMock = vi.mocked(api);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Серверный поиск бесед (#956): список мессенджера и пикер пересылки не
 * фильтруют загруженные 50 строк, а спрашивают сервер (название, участники,
 * название/номер задачи/письма — порты владельцев).
 */
describe('серверный поиск бесед (#956)', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({ items: [], nextCursor: null } as never);
  });

  it('useConversationSearch — один запрос до 100 строк по search', async () => {
    const { result } = renderHook(() => useConversationSearch('Петров'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(apiMock.mock.calls[0]?.[0]);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('search')).toBe('Петров');
    expect(params.get('limit')).toBe('100');
  });

  it('пустой запрос в пикере не уходит на сервер', () => {
    const { result } = renderHook(() => useConversationSearch('   '), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('вкладка мессенджера: scope + search + limit=100, курсор не теряется', async () => {
    const { result } = renderHook(() => useScopedConversations('entities', 'ПП-12'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(apiMock.mock.calls[0]?.[0]);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('scope')).toBe('entities');
    expect(params.get('search')).toBe('ПП-12');
    expect(params.get('limit')).toBe('100');
  });

  it('без поиска вкладка грузит прежний список (без search/limit)', async () => {
    const { result } = renderHook(() => useScopedConversations('chats'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(apiMock.mock.calls[0]?.[0]);
    expect(url).toBe('/chat/conversations?scope=chats');
  });
});
