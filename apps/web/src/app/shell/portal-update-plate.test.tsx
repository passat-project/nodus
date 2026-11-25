// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { usePortalUpdateStore } from '../../features/portal-update/model/portal-update-store.js';

// jsdom: window.location — LegacyUnforgeable (reload не подменить spyOn);
// перезагрузка — отдельная точка подмены.
vi.mock('./reload-portal.js', () => ({ reloadPortal: vi.fn() }));

import { reloadPortal } from './reload-portal.js';
import { PortalUpdatePlate, usePortalUpdateOverlayActive } from './portal-update-plate.js';

/**
 * Плашка «Портал обновился» (#1038, фаза F): только браузер + updateAvailable;
 * кнопка «Обновить» перезагружает страницу; TEMP overlay-вариант — по
 * ?updatePlate=overlay фиксированным уровнем над шапкой.
 */
describe('PortalUpdatePlate (#1038 фаза F)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePortalUpdateStore.setState({ updateAvailable: false, latestVersion: null });
    usePortalUpdateOverlayActive.getState().setActive(false);
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    cleanup();
    delete window.nodusDesktop;
    window.history.replaceState(null, '', '/');
    usePortalUpdateStore.setState({ updateAvailable: false, latestVersion: null });
    usePortalUpdateOverlayActive.getState().setActive(false);
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

  it('TEMP overlay: ?updatePlate=overlay — плашка фиксированным уровнем над шапкой', () => {
    usePortalUpdateStore.setState({ updateAvailable: true });
    window.history.replaceState(null, '', '/?updatePlate=overlay');
    render(<PortalUpdatePlate />);
    const plate = screen
      .getByText(ui.desktop.updatePlate)
      .closest('[data-portal-update-plate]') as HTMLElement;
    expect(plate.dataset.portalUpdatePlateOverlay).toBe('true');
    for (const cls of ['fixed', 'top-0', 'right-16', 'z-30']) {
      expect(plate.classList.contains(cls)).toBe(true);
    }
  });

  it('TEMP overlay: сигнал для шапки и тост-стека публикуется и гаснет', async () => {
    usePortalUpdateStore.setState({ updateAvailable: true });
    window.history.replaceState(null, '', '/?updatePlate=overlay');
    const { unmount } = render(<PortalUpdatePlate />);
    await waitFor(() => {
      expect(usePortalUpdateOverlayActive.getState().active).toBe(true);
    });
    unmount();
    expect(usePortalUpdateOverlayActive.getState().active).toBe(false);
  });

  it('TEMP overlay: дефолтный режим сигнал не включает', async () => {
    usePortalUpdateStore.setState({ updateAvailable: true });
    render(<PortalUpdatePlate />);
    await waitFor(() => {
      expect(screen.getByText(ui.desktop.updatePlate)).toBeTruthy();
    });
    expect(usePortalUpdateOverlayActive.getState().active).toBe(false);
  });
});
