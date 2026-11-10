// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientProviderProps,
} from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadAppButton } from './download-app-button.js';
import { formatDate } from '../../shared/lib/format.js';

/**
 * Кнопка «Скачать приложение» (#263): без раздачи /desktop/ кнопки нет;
 * браузеру — прямая загрузка NSIS-установщика; в оболочке при готовом
 * обновлении — «Обновить приложение» с зелёной точкой.
 */

const MANIFEST = {
  version: '1.0.1',
  notes: 'Кнопка скачивания',
  pub_date: '2026-10-09T11:18:25.537Z',
  platforms: {
    'windows-x86_64-nsis': { url: 'http://127.0.0.1:4173/desktop/Nodus_1.0.1_x64-setup.exe' },
    'windows-x86_64': { url: 'http://127.0.0.1:4173/desktop/Nodus_1.0.1_x64-setup.exe' },
  },
};

function stubFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function installShellBridge(state: { status: string; version: string | null }) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  window.nodusDesktop = {
    shellVersion: '1.0.0',
    platform: 'windows',
    getShellInfo: vi.fn(async () => ({ version: '1.0.0', platform: 'windows' })),
    getUpdateState: vi.fn(async () => state),
    applyUpdate: vi.fn(async () => undefined),
    onEvent: vi.fn((type: string, fn: (payload: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
      return () => undefined;
    }),
  } as unknown as typeof window.nodusDesktop;
  return listeners;
}

function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client } satisfies QueryClientProviderProps,
      createElement(DownloadAppButton) as ReactNode,
    ),
  );
}

beforeEach(() => {
  delete window.nodusDesktop;
});

afterEach(() => {
  // Авто-очистки RTL в этом окружении нет: накопленные деревья прошлых
  // тестов давали «multiple elements» (кнопки с одинаковыми именами).
  cleanup();
  vi.useRealTimers();
  delete window.nodusDesktop;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('браузер', () => {
  it('нет манифеста — кнопки нет (fail-safe)', async () => {
    vi.stubGlobal('fetch', stubFetch(404, {}));
    renderButton();
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
  });

  it('манифест есть — кнопка ведёт на NSIS-установщику, без лишнего текста', async () => {
    vi.stubGlobal('fetch', stubFetch(200, MANIFEST));
    renderButton();
    const link = await screen.findByRole('link', { name: 'Скачать приложение' });
    expect(link.getAttribute('href')).toBe(MANIFEST.platforms['windows-x86_64-nsis'].url);
    expect(screen.queryByText('bg-success')).toBeNull();
  });
});

describe('оболочка', () => {
  it('манифест недоступен — кнопка-точка ВСЁ РАВНО есть с первого кадра (фидбек 09.10)', async () => {
    // При первом открытии фетч манифеста спотыкался — кнопки не было до
    // перехода по разделам (ремоунт). В оболочке кнопка = точка обновления
    // из моста: от сетевого манифеста её видимость не зависит.
    installShellBridge({ status: 'idle', version: null });
    vi.stubGlobal('fetch', stubFetch(404, {}));
    renderButton();
    const button = await screen.findByRole('button', { name: 'Скачать приложение' });
    fireEvent.mouseEnter(button);
    await waitFor(() => expect(screen.getByText('Новых версий нет')).toBeTruthy(), {
      timeout: 1500,
    });
  });

  it('манифест недоступен, обновление готово — точка и кнопка обновления работают', async () => {
    installShellBridge({ status: 'available', version: '1.0.5' });
    vi.stubGlobal('fetch', stubFetch(404, {}));
    renderButton();
    const button = await screen.findByRole('button', { name: 'Обновить приложение' });
    expect(button.querySelector('.bg-success')).not.toBeNull();
  });

  it('обновление скачано — точка + «Обновить приложение» + переход версии', async () => {
    installShellBridge({ status: 'available', version: '1.0.1' });
    vi.stubGlobal('fetch', stubFetch(200, MANIFEST));
    renderButton();
    const button = await screen.findByRole('button', { name: 'Обновить приложение' });
    expect(button.querySelector('.bg-success')).not.toBeNull();

    fireEvent.mouseEnter(button);
    // Фидбек 09.10: рядом с «доступна новая» обязана быть своя версия —
    // голое число с сервера читалось как «у вас 1.0.4».
    await waitFor(() => expect(screen.getByText('1.0.0 → 1.0.1')).toBeTruthy());

    fireEvent.mouseEnter(button);
    const notes = await waitFor(() => screen.getByText(/Кнопка скачивания/), { timeout: 1500 });
    expect(notes.className).toContain('overflow-y-auto');
  });

  it('обновления нет — без точки, установленная версия + «Новых версий нет»', async () => {
    installShellBridge({ status: 'idle', version: null });
    vi.stubGlobal('fetch', stubFetch(200, MANIFEST));
    renderButton();
    const button = await screen.findByRole('button', { name: 'Скачать приложение' });
    expect(button.querySelector('.bg-success')).toBeNull();

    fireEvent.mouseEnter(button);
    await waitFor(() => expect(screen.getByText('Новых версий нет')).toBeTruthy(), {
      timeout: 1500,
    });
    // Версия УСТАНОВЛЕННОЙ оболочки (мост), не серверный манифест: «1.0.1 /
    // Новых версий нет» — противоречие на экране (фидбек 09.10).
    expect(screen.getByText('1.0.0')).toBeTruthy();
    expect(screen.queryByText('1.0.1')).toBeNull();
  });

  it('потерянное событие восполняется опросом: точка появляется без перезагрузки', async () => {
    // Фидбек 09.10: пуш update-state прилетал eval'ом раньше слушателя —
    // точка ждала Ctrl+Shift+R. Опрос каждые 15с закрывает окно гонки.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: { status: string; version: string | null } = {
      status: 'downloading',
      version: '1.0.4',
    };
    installShellBridge(state);
    const bridge = window.nodusDesktop!;
    vi.spyOn(bridge, 'getUpdateState').mockImplementation(async () => state);
    vi.stubGlobal('fetch', stubFetch(200, MANIFEST));
    renderButton();
    await screen.findByRole('button', { name: 'Скачать приложение' });
    // Скачивание завершилось ПОСЛЕ монтирования, событие потерялось:
    state = { status: 'available', version: '1.0.4' };
    await vi.advanceTimersByTimeAsync(16_000);
    const button = await screen.findByRole('button', { name: 'Обновить приложение' });
    expect(button.querySelector('.bg-success')).not.toBeNull();
  });

  it('манифест старше обновления: версия из моста, чужого «что нового» нет (#739)', async () => {
    // Долгоживущее окно портала держит манифест, загруженный ДО публикации
    // выпуска; мост уже знает реальную целевую версию (её и установит).
    installShellBridge({ status: 'available', version: '1.0.16' });
    vi.stubGlobal(
      'fetch',
      stubFetch(200, { ...MANIFEST, version: '1.0.15', notes: 'Старый текст про курсор' }),
    );
    renderButton();
    const button = await screen.findByRole('button', { name: 'Обновить приложение' });
    fireEvent.mouseEnter(button);

    await waitFor(() => expect(screen.getByText('1.0.0 → 1.0.16')).toBeTruthy());
    // Текст чужого выпуска не показываем: лучше без заметок, чем старые.
    expect(screen.queryByText(/Старый текст про курсор/)).toBeNull();
    // Дата тоже от чужого манифеста — не показывается (#739).
    expect(screen.queryByText(formatDate(MANIFEST.pub_date))).toBeNull();
  });

  it('манифест догоняет целевую версию рефетчем — заметки новой версии (#739)', async () => {
    installShellBridge({ status: 'available', version: '1.0.16' });
    const stale = { ...MANIFEST, version: '1.0.15', notes: 'Старый текст про курсор' };
    const fresh = { ...MANIFEST, version: '1.0.16', notes: 'Перетаскивание файлов' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(stale), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify(fresh), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderButton();
    const button = await screen.findByRole('button', { name: 'Обновить приложение' });
    fireEvent.mouseEnter(button);

    await waitFor(() => expect(screen.getByText(/Перетаскивание файлов/)).toBeTruthy(), {
      timeout: 2000,
    });
    expect(screen.queryByText(/Старый текст про курсор/)).toBeNull();
    expect(screen.getByText('1.0.0 → 1.0.16')).toBeTruthy();
    // Манифест совпал с целевой версией — дата его выпуска снова правдива.
    expect(screen.getByText(formatDate(MANIFEST.pub_date))).toBeTruthy();
  });
});
