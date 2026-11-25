// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { usePortalUpdateStore } from '../../features/portal-update/model/portal-update-store.js';

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
  usePortalUpdateStore.setState({ updateAvailable: false, latestVersion: null });
  window.history.replaceState(null, '', '/');
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

/** #1038 (фаза G): «Что нового» ушло из строки топбара в меню аватара —
 *  кнопки-искорки в топбаре больше нет (вход — ProfileMenu). */
describe('«Что нового» в топбаре (#1038 фаза G)', () => {
  it('кнопки WhatsNewButton в строке нет — вход через меню аватара', () => {
    render(<TopBar />);
    expect(screen.queryByRole('button', { name: ui.whatsNew.open })).toBeNull();
  });
});

/** #1038 (фаза F): плашка «Портал обновился» — в потоке правой группы
 *  топбара, только в браузере при updateAvailable. */
describe('Плашка обновления портала в топбаре (#1038 фаза F)', () => {
  it('без обновления — плашки нет', () => {
    render(<TopBar />);
    expect(screen.queryByText(ui.desktop.updatePlate)).toBeNull();
  });

  it('в браузере при updateAvailable — плашка в строке топбара', () => {
    usePortalUpdateStore.setState({ updateAvailable: true });
    render(<TopBar />);
    const plate = screen.getByText(ui.desktop.updatePlate);
    expect(plate).toBeTruthy();
    expect(plate.closest('header[data-topbar]')).toBeTruthy();
  });

  it('в оболочке — плашки нет (обновление применяет панель окна)', () => {
    usePortalUpdateStore.setState({ updateAvailable: true });
    window.nodusDesktop = {
      shellVersion: '1.0.0',
      platform: 'windows',
    } as unknown as typeof window.nodusDesktop;
    render(<TopBar />);
    expect(screen.queryByText(ui.desktop.updatePlate)).toBeNull();
  });
});
