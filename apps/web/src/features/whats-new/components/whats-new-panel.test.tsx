// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { AUTO_OPEN_DELAY_MS, useWhatsNewAutoOpen } from '../model/use-whats-new-auto-open.js';
import { LATEST_RELEASE } from '../model/releases.js';
import { useWhatsNewStore } from '../model/whats-new-store.js';
import { WhatsNewButton } from './whats-new-button.js';
import { WhatsNewPanel } from './whats-new-panel.js';

/**
 * «Что нового» (#386): автопоказ один раз на пользователя после обновления,
 * кнопка топбара открывает историю, чипы фильтруют пункты по модулю.
 */
const USER = { id: 'user-a', email: 'a@nodus.by', displayName: 'Анна', permissions: [] };

function Harness() {
  useWhatsNewAutoOpen();
  return (
    <>
      <WhatsNewButton />
      <WhatsNewPanel />
    </>
  );
}

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER });
  useWhatsNewStore.setState({ seen: {}, open: false, openReason: 'manual' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('панель «Что нового»', () => {
  it('открывается сама после обновления и отмечает выпуск просмотренным', () => {
    vi.useFakeTimers();
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS);
    });
    expect(screen.getByRole('dialog', { name: ui.whatsNew.title })).toBeTruthy();
    expect(useWhatsNewStore.getState().seen[USER.id]).toBe(LATEST_RELEASE?.version);
  });

  it('просмотренный выпуск повторно сам не открывается', () => {
    vi.useFakeTimers();
    useWhatsNewStore.setState({ seen: { [USER.id]: LATEST_RELEASE!.version } });
    render(<Harness />);
    act(() => {
      vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS * 2);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('кнопка открывает панель; чип модуля оставляет только его пункты', () => {
    useWhatsNewStore.setState({ seen: { [USER.id]: LATEST_RELEASE!.version } });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: ui.whatsNew.open }));
    const dialog = screen.getByRole('dialog', { name: ui.whatsNew.title });
    const totalItems = dialog.querySelectorAll('li').length;
    expect(totalItems).toBe(LATEST_RELEASE!.items.length);

    // Модуль, который есть в свежем выпуске (у «Мессенджера» может не быть
    // изменений — тогда панель честно показывает выпуск, где они были).
    fireEvent.click(screen.getByRole('button', { name: ui.nav.tasks }));
    const taskItems = LATEST_RELEASE!.items.filter((i) => i.module === 'tasks').length;
    expect(taskItems).toBeGreaterThan(0);
    expect(dialog.querySelectorAll('li').length).toBe(taskItems);
  });

  it('фильтр по модулю без изменений в свежем выпуске: первый показанный выпуск развёрнут', () => {
    useWhatsNewStore.setState({ seen: { [USER.id]: LATEST_RELEASE!.version } });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: ui.whatsNew.open }));
    const dialog = screen.getByRole('dialog', { name: ui.whatsNew.title });

    // «Корреспонденция» есть в 0.11.0, но не в свежем 0.12.0: первый
    // показанный выпуск — старый, раньше он стартовал свёрнутым (пустая панель).
    fireEvent.click(screen.getByRole('button', { name: ui.nav.letters }));
    expect(dialog.querySelectorAll('li').length).toBeGreaterThan(0);
  });
});
