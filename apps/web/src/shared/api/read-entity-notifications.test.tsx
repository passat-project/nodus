// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { desktopDismissPopups, isDesktopShell } from '../desktop/desktop-bridge.js';
import { api } from '../api-client.js';
import { resetAttentionForTests, startAttentionTracking } from '../attention/attention-store.js';
import { registerModalLayer, resetModalLayersForTests } from '../attention/modal-layers.js';
import { SurfaceVisibilityProvider } from '../lib/surface-visibility.js';
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

/** Накрытие карточки: видимость поверхности переключается на лету (#770). */
function mountWithSurface(sourceId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let visible = false;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SurfaceVisibilityProvider visible={visible}>{children}</SurfaceVisibilityProvider>
    </QueryClientProvider>
  );
  const { rerender } = renderHook(() => useReadEntityNotifications('letter', sourceId), {
    wrapper,
  });
  return {
    show: () => {
      visible = true;
      rerender();
    },
  };
}

/** Просмотр = прочтение (#252); в оболочке открытие гасит и попапы (#618). */
describe('useReadEntityNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockResolvedValue({ read: 1 } as never);
    vi.mocked(isDomainMocked).mockReturnValue(false);
    // Модель внимания (#770): активный пользователь у видимой поверхности.
    resetAttentionForTests();
    startAttentionTracking();
    resetModalLayersForTests();
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

  it('карточка накрыта — не гасит; вернулась на вид — гасит (#770)', async () => {
    vi.mocked(isDesktopShell).mockReturnValue(true);
    const surface = mountWithSurface(LETTER);
    expect(api).not.toHaveBeenCalled();
    expect(desktopDismissPopups).not.toHaveBeenCalled();
    surface.show();
    await waitFor(() => {
      expect(api).toHaveBeenCalledTimes(1);
    });
    expect(desktopDismissPopups).toHaveBeenCalledWith(LETTER);
  });

  it('пользователь не активен — ждёт возврата внимания (#770)', async () => {
    resetAttentionForTests({ focused: false, lastInputAt: 0 });
    startAttentionTracking();
    mount(LETTER);
    expect(api).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(api).toHaveBeenCalledTimes(1);
    });
  });

  it('модальный слой над карточкой — не гасит; слой закрылся — гасит (#809)', async () => {
    vi.mocked(isDesktopShell).mockReturnValue(true);
    const releaseLayer = registerModalLayer(document.createElement('div'));
    mount(LETTER);
    expect(api).not.toHaveBeenCalled();
    expect(desktopDismissPopups).not.toHaveBeenCalled();

    act(() => {
      releaseLayer();
    });
    await waitFor(() => {
      expect(api).toHaveBeenCalledTimes(1);
    });
    expect(desktopDismissPopups).toHaveBeenCalledWith(LETTER);
  });
});
