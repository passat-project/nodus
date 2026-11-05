// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { desktopDismissPopups, isDesktopShell } from '../desktop/desktop-bridge.js';
import { api } from '../api-client.js';
import { isDomainMocked } from './api-mock-config.js';
import { useReadEntityNotifications } from './read-entity-notifications.js';

vi.mock('../desktop/desktop-bridge.js', () => ({
  isDesktopShell: vi.fn(),
  desktopDismissPopups: vi.fn(),
}));
vi.mock('../api-client.js', () => ({ api: vi.fn() }));
vi.mock('./api-mock-config.js', () => ({ isDomainMocked: vi.fn() }));

const LETTER = '11111111-1111-4111-8111-111111111111';

function mount(sourceId: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  renderHook(() => useReadEntityNotifications('letter', sourceId), { wrapper });
}

/** Просмотр = прочтение (#252); в оболочке открытие гасит и попапы (#618). */
describe('useReadEntityNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue({ read: 1 } as never);
    vi.mocked(isDomainMocked).mockReturnValue(false);
  });

  it('открытие письма: гасит попапы оболочки и шлёт read-by-source', async () => {
    vi.mocked(isDesktopShell).mockReturnValue(true);
    mount(LETTER);
    expect(desktopDismissPopups).toHaveBeenCalledWith(LETTER);
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/notifications/read-by-source', {
        method: 'POST',
        body: { sourceType: 'letter', sourceId: LETTER },
      });
    });
  });

  it('вне оболочки попапы не трогает, read всё равно шлёт', async () => {
    vi.mocked(isDesktopShell).mockReturnValue(false);
    mount(LETTER);
    expect(desktopDismissPopups).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(api).toHaveBeenCalledTimes(1);
    });
  });

  it('мок-режим домена: без сетевого вызова', () => {
    vi.mocked(isDomainMocked).mockReturnValue(true);
    mount(LETTER);
    expect(api).not.toHaveBeenCalled();
  });

  it('временный id (оптимистичная сущность): ничего не делает', () => {
    mount('temp-abc');
    expect(api).not.toHaveBeenCalled();
    expect(desktopDismissPopups).not.toHaveBeenCalled();
  });
});
