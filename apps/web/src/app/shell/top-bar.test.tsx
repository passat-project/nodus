// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Топбар #1038 (фаза B2): в оболочке кнопка «Скачать приложение» переезжает
 * в панель окна — в топбаре не рендерится; в браузере остаётся. Тяжёлые
 * соседи по топбару подменены заглушками — проверяется только условие
 * рендера DownloadAppButton.
 */

// Роутер — вне RouterProvider (паттерн right-rail.test.tsx).
vi.mock('@tanstack/react-router', () => ({
  useRouterState: (opts?: { select?: (s: unknown) => unknown }) =>
    opts?.select
      ? opts.select({ location: { pathname: '/home' } })
      : { location: { pathname: '/home' } },
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../features/assistant/model/use-assistant-enabled.js', () => ({
  useAssistantEnabled: () => false,
}));
vi.mock('../../features/home/components/home-greeting.js', () => ({
  HomeGreeting: () => null,
}));
vi.mock('../../features/notifications/components/bell-popover.js', () => ({
  BellPopover: () => null,
}));
vi.mock('../../features/tasks/components/running-timer-chip.js', () => ({
  RunningTimerChip: () => null,
}));
vi.mock('../../features/whats-new/components/whats-new-button.js', () => ({
  WhatsNewButton: () => null,
}));
vi.mock('./profile-menu.js', () => ({ ProfileMenu: () => null }));
vi.mock('../../shared/chat/chat-queries.js', () => ({
  useChatUnreadSummary: () => ({ data: undefined }),
}));
vi.mock('./download-app-button.js', () => ({
  DownloadAppButton: () => <div data-testid="download-app-button" />,
}));

import { TopBar } from './top-bar.js';

afterEach(() => {
  cleanup();
  delete window.nodusDesktop;
});

describe('DownloadAppButton в топбаре (#1038)', () => {
  it('в браузере — на месте', () => {
    render(<TopBar />);
    expect(screen.getByTestId('download-app-button')).toBeTruthy();
  });

  it('в оболочке — скрыта (кнопка переехала в панель окна)', () => {
    window.nodusDesktop = {
      shellVersion: '1.0.0',
      platform: 'windows',
    } as unknown as typeof window.nodusDesktop;
    render(<TopBar />);
    expect(screen.queryByTestId('download-app-button')).toBeNull();
  });
});
