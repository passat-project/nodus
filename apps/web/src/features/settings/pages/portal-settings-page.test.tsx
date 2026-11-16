// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { PortalSettingsPage } from './portal-settings-page.js';

/**
 * Страница «Настройки портала» (#558): без права — заглушка; с правом —
 * разделы и переход в «Права доступа» через search-параметр.
 */

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => ({}),
}));

vi.mock('../../../shared/access/module-access-matrix.js', () => ({
  ModuleAccessMatrix: () => <div>матрица прав</div>,
}));

vi.mock('../components/file-servers-section.js', () => ({
  FileServersSection: () => <div>файловые серверы</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAuthStore.setState({ user: null });
});

function asUser(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: '55000000-0000-4000-8000-000000000001',
      email: 'admin@example.com',
      displayName: 'Администратор',
      permissions,
    } as never,
  });
}

describe('страница настроек портала', () => {
  it('без права — «Нет доступа»', () => {
    asUser([]);
    render(<PortalSettingsPage />);
    expect(screen.getByText(ui.portalSettings.noAccess)).toBeTruthy();
  });

  it('с правом — разделы; «Права доступа» ведут search-параметром', () => {
    asUser(['portal.settings.manage']);
    render(<PortalSettingsPage />);
    expect(screen.getByText(ui.portalSettings.title)).toBeTruthy();
    expect(screen.getByText('файловые серверы')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.portalSettings.sections.access }));
    expect(navigate).toHaveBeenCalledTimes(1);
    const call = navigate.mock.calls[0]?.[0] as {
      to: string;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.to).toBe('/settings');
    expect(call.search({ foo: 1 })).toEqual({ foo: 1, section: 'access' });
  });
});
