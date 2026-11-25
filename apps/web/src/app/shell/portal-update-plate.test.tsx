// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { usePortalUpdateStore } from '../../features/portal-update/model/portal-update-store.js';

// jsdom: window.location — LegacyUnforgeable (reload не подменить spyOn);
// перезагрузка — отдельная точка подмены.
vi.mock('./reload-portal.js', () => ({ reloadPortal: vi.fn() }));

import { reloadPortal } from './reload-portal.js';
import { PortalUpdatePlate } from './portal-update-plate.js';

/**
 * Плашка «Портал обновился» (#1038, фаза F): только браузер + updateAvailable;
 * кнопка «Обновить» перезагружает страницу. Единственный вариант — строка в
 * потоке правой группы топбара (overlay-уровень отклонён вердиктом владельца
 * 25.11, временный вариант удалён).
 */
describe('PortalUpdatePlate (#1038 фаза F)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePortalUpdateStore.setState({ updateAvailable: false, latestVersion: null });
  });

  afterEach(() => {
    cleanup();
    delete window.nodusDesktop;
    usePortalUpdateStore.setState({ updateAvailable: false, latestVersion: null });
  });

  it('без обновления — плашки нет', () => {
    render(<PortalUpdatePlate />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('браузер + updateAvailable — плашка в строке: точка, текст, кнопка', () => {
    usePortalUpdateStore.setState({ updateAvailable: true });
    render(<PortalUpdatePlate />);
    expect(screen.getByText(ui.desktop.updatePlate)).toBeTruthy();
    const plate = screen
      .getByText(ui.desktop.updatePlate)
      .closest('[data-portal-update-plate]') as HTMLElement;
    // В потоке, не поверх: без fixed-позиционирования.
    expect(plate.classList.contains('bg-muted')).toBe(true);
    expect(plate.classList.contains('fixed')).toBe(false);
    expect(plate.querySelector('.bg-success')).not.toBeNull();
  });

  it('в десктоп-оболочке — плашки нет (обновление применяет панель окна)', () => {
    usePortalUpdateStore.setState({ updateAvailable: true });
    window.nodusDesktop = {
      shellVersion: '1.0.0',
      platform: 'windows',
    } as unknown as typeof window.nodusDesktop;
    render(<PortalUpdatePlate />);
    expect(screen.queryByText(ui.desktop.updatePlate)).toBeNull();
  });

  it('кнопка «Обновить» перезагружает страницу', () => {
    usePortalUpdateStore.setState({ updateAvailable: true });
    render(<PortalUpdatePlate />);
    fireEvent.click(screen.getByRole('button', { name: ui.desktop.updatePlateButton }));
    expect(vi.mocked(reloadPortal)).toHaveBeenCalledTimes(1);
  });
});
