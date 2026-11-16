// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FileServersResponse } from '@nodus/contracts';

vi.mock('../../../shared/api-client.js', () => ({
  api: vi.fn(),
}));

/**
 * I4 (#558): «Файловые серверы» — оптимистичная полная замена списка.
 * Детерминированный deferred-тест: кэш обновлён ДО ответа, reject откатывает.
 */
describe('useUpdateFileServers: оптимистичность', () => {
  const initial: FileServersResponse = {
    servers: ['\\\\FS01\\Projects'],
    updatedAt: '2026-11-16T10:00:00.000Z',
  };
  const next: FileServersResponse = {
    servers: ['\\\\FS01\\Projects', '\\\\FS02\\Docs'],
    updatedAt: '2026-11-16T10:01:00.000Z',
  };

  it('кэш обновлён до ответа; ошибка откатывает список', async () => {
    const rejectRef: { fn: (error: unknown) => void } = { fn: () => {} };
    const promise = new Promise<FileServersResponse>((_resolve, reject) => {
      rejectRef.fn = reject;
    });
    const { api } = await import('../../../shared/api-client.js');
    vi.mocked(api).mockReturnValueOnce(promise);

    const { useUpdateFileServers, fileServersQueryKey } = await import('./file-servers.js');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(fileServersQueryKey, initial);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useUpdateFileServers(), { wrapper });
    await act(async () => {
      result.current.mutate(next.servers);
    });

    expect(queryClient.getQueryData<FileServersResponse>(fileServersQueryKey)?.servers).toEqual(
      next.servers,
    );

    rejectRef.fn(new Error('network'));
    await waitFor(() =>
      expect(queryClient.getQueryData<FileServersResponse>(fileServersQueryKey)).toEqual(initial),
    );
  });

  it('успех кладёт ответ сервера (нормализованный список)', async () => {
    const { api } = await import('../../../shared/api-client.js');
    vi.mocked(api).mockResolvedValueOnce(next);
    const { useUpdateFileServers, fileServersQueryKey } = await import('./file-servers.js');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(fileServersQueryKey, initial);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateFileServers(), { wrapper });
    await act(async () => {
      result.current.mutate(next.servers);
    });
    await waitFor(() =>
      expect(queryClient.getQueryData<FileServersResponse>(fileServersQueryKey)).toEqual(next),
    );
  });
});
