// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  mcpSettingsQueryKey,
  useMcpSettingsQuery,
  useTestMcpServer,
  useUpdateMcpSettings,
} from './mcp-settings.js';

/**
 * Хуки реестра MCP (#902): путь запроса, ключ кэша и инвалидация после PUT —
 * канон `api/*` модуля настроек.
 */

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('../../../shared/api-client.js', () => ({ api: mocks.api }));

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  mocks.api.mockReset();
});

describe('api/mcp-settings', () => {
  it('GET реестра идёт на /settings/ai/mcp', async () => {
    mocks.api.mockResolvedValue({ servers: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMcpSettingsQuery(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.api).toHaveBeenCalledWith('/settings/ai/mcp');
  });

  it('PUT кладёт ответ в кэш реестра', async () => {
    const saved = { servers: [{ id: 'a' }] };
    mocks.api.mockResolvedValue(saved);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useUpdateMcpSettings(), { wrapper: wrapper(client) });
    await result.current.mutateAsync({ servers: [] });
    expect(mocks.api).toHaveBeenCalledWith('/settings/ai/mcp', {
      method: 'PUT',
      body: { servers: [] },
    });
    expect(client.getQueryData(mcpSettingsQueryKey)).toEqual(saved);
  });

  it('проверка соединения — POST на /settings/ai/mcp/:id/test', async () => {
    mocks.api.mockResolvedValue({ ok: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useTestMcpServer(), { wrapper: wrapper(client) });
    await result.current.mutateAsync('22222222-2222-4222-8222-222222222222');
    expect(mocks.api).toHaveBeenCalledWith(
      '/settings/ai/mcp/22222222-2222-4222-8222-222222222222/test',
      { method: 'POST' },
    );
  });
});
