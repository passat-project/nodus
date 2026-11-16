// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { PortalSettingsPage } from './portal-settings-page.js';

/**
 * Страница «Настройки портала» (#558): без права — заглушка; с правом —
 * раздел по вкладке топбара (`?tab=access` — «Права доступа», иначе
 * «Файловые серверы»). Левое перечисление разделов убрано (вердикт
 * владельца 16.11.2026) — разделы живут вкладками в топбаре.
 */

const { search } = vi.hoisted(() => ({ search: { current: {} as { tab?: string } } }));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => search.current,
}));

vi.mock('../../../shared/access/module-access-matrix.js', () => ({
  ModuleAccessMatrix: () => <div>матрица прав</div>,
}));

vi.mock('../components/file-servers-section.js', () => ({
  FileServersSection: () => <div>файловые серверы</div>,
}));

afterEach(() => {
  cleanup();
  search.current = {};
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

  it('по умолчанию — «Файловые серверы», без левого перечисления', () => {
    asUser(['portal.settings.manage']);
    render(<PortalSettingsPage />);
    expect(screen.getByText('файловые серверы')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: ui.portalSettings.title })).toBeNull();
    expect(screen.queryByRole('button', { name: ui.portalSettings.sections.access })).toBeNull();
  });

  it('?tab=access — матрица прав раздела «Настройки»', () => {
    asUser(['portal.settings.manage']);
    search.current = { tab: 'access' };
    render(<PortalSettingsPage />);
    expect(screen.getByText('матрица прав')).toBeTruthy();
  });
});
