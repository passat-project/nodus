// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SHELL_PANEL_HEIGHT } from '@nodus/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePortalUpdateStore } from '../../features/portal-update/model/portal-update-store.js';
import { ShellPanel } from './shell-panel.js';

/**
 * Панель безрамочного окна (#1038, фаза B2): кнопки окна через мост, точка
 * обновления портала на ⟳, копирование адреса (лимит длины), коллаут под
 * панелью, окно «Приложение» с установкой обновления оболочки. Фейковый мост
 * повторяет сигнатуру bridge.rs (как download-app-button.test).
 */

const MANIFEST = {
  version: '1.0.2',
  notes: 'Первая строка выпуска.\n\nВторой абзац про панель.',
  pub_date: '2026-11-25T10:00:00.000Z',
  platforms: { 'windows-x86_64-nsis': { url: 'http://127.0.0.1:4173/desktop/setup.exe' } },
};

type UpdateState = { status: 'idle' | 'downloading' | 'available'; version: string | null };

function installShellBridge(updateState: UpdateState = { status: 'idle', version: null }) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const windowState = { maximized: false };
  const bridge = {
    shellVersion: '1.0.0',
    platform: 'windows',
    getShellInfo: vi.fn(async () => ({ version: '1.0.0', platform: 'windows' })),
    getUpdateState: vi.fn(async () => updateState),
    applyUpdate: vi.fn(async () => undefined),
    copyText: vi.fn(async () => undefined),
    windowMinimize: vi.fn(async () => undefined),
    windowToggleMaximize: vi.fn(async () => undefined),
    windowClose: vi.fn(async () => undefined),
    windowStartDragging: vi.fn(async () => undefined),
    windowIsMaximized: vi.fn(async () => windowState.maximized),
    onEvent: vi.fn((type: string, fn: (payload: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
      return () => undefined;
    }),
  };
  window.nodusDesktop = bridge as unknown as typeof window.nodusDesktop;
  const emit = (type: string, payload: unknown) =>
    (listeners.get(type) ?? []).forEach((fn) => fn(payload));
  return { bridge, emit, windowState };
}

function stubManifest(body: unknown = MANIFEST, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(QueryClientProvider, { client }, createElement(ShellPanel) as ReactNode),
  );
}

function resetPortalUpdate(): void {
  usePortalUpdateStore.setState({ latestVersion: null, updateAvailable: false });
}

beforeEach(() => {
  delete window.nodusDesktop;
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
  delete window.nodusDesktop;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetPortalUpdate();
});

describe('каркас панели', () => {
  it('высота из контракта SHELL_PANEL_HEIGHT, заглушки назад/вперёд/загрузки disabled', () => {
    installShellBridge();
    vi.stubGlobal('fetch', stubManifest(null, 404));
    renderPanel();
    const panel = screen.getByRole('button', { name: 'Назад' }).closest('[data-shell-panel]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('style')).toContain(`height: ${SHELL_PANEL_HEIGHT}px`);

    expect((screen.getByRole('button', { name: 'Назад' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Вперёд' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Загрузки' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Обновить страницу' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Копировать адрес' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('кнопка максимизации — фиксированный id для snap-плагина, без обработчика клика', () => {
    installShellBridge();
    vi.stubGlobal('fetch', stubManifest(null, 404));
    const { container } = renderPanel();
    const maximize = container.querySelector('#portal-window-maximize');
    expect(maximize).not.toBeNull();
    // Клик обрабатывает нативный оверлей snap-плагина: onClick на кнопке
    // запрещён (ADR-0055) — React-обёртка не должна навешивать обработчик.
    const props = maximize as unknown as { onclick: unknown };
    expect(props.onclick).toBeNull();
  });
});

describe('кнопки окна и drag-зона', () => {
  it('свернуть/закрыть уходят в мост; drag-зона тащит окно и разворачивает двойным кликом', () => {
    const { bridge } = installShellBridge();
    vi.stubGlobal('fetch', stubManifest(null, 404));
    const { container } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(bridge.windowMinimize).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть окно' }));
    expect(bridge.windowClose).toHaveBeenCalledTimes(1);

    const zone = container.querySelector('[data-shell-drag-zone]') as HTMLElement;
    expect(zone).not.toBeNull();
    fireEvent.pointerDown(zone, { button: 0 });
    expect(bridge.windowStartDragging).toHaveBeenCalledTimes(1);
    // Не-левая кнопка окно не тащит.
    fireEvent.pointerDown(zone, { button: 2 });
    expect(bridge.windowStartDragging).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(zone);
    expect(bridge.windowToggleMaximize).toHaveBeenCalledTimes(1);
  });

  it('иконка □/❐: mount + событие фокуса окна перечитывают состояние', async () => {
    const { emit, windowState } = installShellBridge();
    vi.stubGlobal('fetch', stubManifest(null, 404));
    renderPanel();
    // На mount окно не развёрнуто — «Развернуть» (□).
    expect(screen.getByRole('button', { name: 'Развернуть' })).toBeTruthy();

    // Снап развернул окно — оболочка прислала фокус, состояние перечитано.
    windowState.maximized = true;
    emit('shell-focus', { focused: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Восстановить' })).toBeTruthy());
  });
});

describe('копирование адреса', () => {
  it('короткий адрес уходит в мост copyText', async () => {
    const { bridge } = installShellBridge();
    vi.stubGlobal('fetch', stubManifest(null, 404));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Копировать адрес' }));
    await waitFor(() => expect(bridge.copyText).toHaveBeenCalledWith(window.location.href));
  });

  it('URL длиннее лимита моста — тишина, копирования нет', async () => {
    const { bridge } = installShellBridge();
    vi.stubGlobal('fetch', stubManifest(null, 404));
    renderPanel();
    window.history.pushState({}, '', `/${'a'.repeat(4200)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Копировать адрес' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bridge.copyText).not.toHaveBeenCalled();
  });
});

describe('обновление портала (точка ⟳ и коллаут)', () => {
  it('зелёная точка на ⟳ и коллаут под панелью; закрытие — до конца сессии', async () => {
    installShellBridge();
    vi.stubGlobal('fetch', stubManifest(null, 404));
    renderPanel();

    const reload = screen.getByRole('button', { name: 'Обновить страницу' });
    expect(reload.querySelector('.bg-success')).toBeNull();
    expect(screen.queryByText('Вышло обновление портала — обновите страницу')).toBeNull();

    usePortalUpdateStore.setState({ updateAvailable: true, latestVersion: '99.0.0' });
    await waitFor(() => expect(reload.querySelector('.bg-success')).not.toBeNull());
    expect(screen.getByText('Вышло обновление портала — обновите страницу')).toBeTruthy();

    // Крестик закрывает плашку; точка на ⟳ остаётся.
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() =>
      expect(screen.queryByText('Вышло обновление портала — обновите страницу')).toBeNull(),
    );
    expect(reload.querySelector('.bg-success')).not.toBeNull();

    // Повторный детект в той же сессии плашку не возвращает.
    usePortalUpdateStore.setState({ updateAvailable: false });
    usePortalUpdateStore.setState({ updateAvailable: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Вышло обновление портала — обновите страницу')).toBeNull();
  });
});

describe('окно «Приложение Nodus»', () => {
  it('точка на знаке при готовом обновлении; окно показывает версию, заметки и ставит обновление', async () => {
    installShellBridge({ status: 'available', version: '1.0.2' });
    vi.stubGlobal('fetch', stubManifest());
    const { container } = renderPanel();

    const appMenu = screen.getByRole('button', { name: 'Приложение' });
    await waitFor(() => expect(appMenu.querySelector('.bg-success')).not.toBeNull());

    fireEvent.click(appMenu);
    expect(await screen.findByText('Приложение Nodus')).toBeTruthy();
    // Установленная версия — из моста, целевая — рядом (#739: не «1.0.2 → 1.0.2»).
    expect(screen.getByText('1.0.0')).toBeTruthy();
    expect(screen.getByText('1.0.2')).toBeTruthy();
    // Заметки — параграфами по пустой строке.
    expect(screen.getByText('Первая строка выпуска.')).toBeTruthy();
    expect(screen.getByText('Второй абзац про панель.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Скачать и установить' }));
    await waitFor(() =>
      expect(
        (window.nodusDesktop as unknown as { applyUpdate: ReturnType<typeof vi.fn> }).applyUpdate,
      ).toHaveBeenCalledTimes(1),
    );
    expect(container.querySelector('[data-shell-panel]')).not.toBeNull();
  });

  it('без обновления — «Обновлений нет», кнопки установки нет', async () => {
    installShellBridge();
    vi.stubGlobal('fetch', stubManifest());
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Приложение' }));
    expect(await screen.findByText('Приложение Nodus')).toBeTruthy();
    expect(screen.getByText('Обновлений нет')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Скачать и установить' })).toBeNull();
  });
});
