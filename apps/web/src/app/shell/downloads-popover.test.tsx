// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadsPopoverButton } from './downloads-popover.js';

/**
 * Кнопка «Загрузки» панели (эпик #1038): поповер реестра — строки, кнопка
 * «Показать в папке» у успешных (мост downloadReveal), бейдж у неуспешных,
 * пустое состояние после ответа моста.
 */

const OK = {
  id: '00000000-0000-4000-8000-0000000000d1',
  fileName: 'смета.pdf',
  path: 'C:\\Users\\k\\Downloads\\смета.pdf',
  success: true,
  finishedAtMs: Date.now(),
};
const FAILED = {
  id: '00000000-0000-4000-8000-0000000000d2',
  fileName: 'чертёж.dwg',
  path: '',
  success: false,
  finishedAtMs: Date.now(),
};

function installBridge(list: unknown) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const bridge = {
    shellVersion: '1.0.0',
    platform: 'windows',
    downloadsList: vi.fn(async () => list),
    downloadReveal: vi.fn(async () => undefined),
    shellReady: vi.fn(async () => undefined),
    onEvent: vi.fn((type: string, fn: (payload: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
      return () => undefined;
    }),
  };
  window.nodusDesktop = bridge as unknown as typeof window.nodusDesktop;
  return bridge;
}

function renderButton() {
  return render(createElement(DownloadsPopoverButton) as ReactNode);
}

async function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: 'Загрузки' }));
  await waitFor(() => expect(screen.getByText('Загрузки')).toBeTruthy());
}

beforeEach(() => {
  delete window.nodusDesktop;
});

afterEach(() => {
  cleanup();
  delete window.nodusDesktop;
  vi.restoreAllMocks();
});

describe('поповер «Загрузки»', () => {
  it('строки реестра; «Показать в папке» зовёт мост с путём записи', async () => {
    const bridge = installBridge([OK]);
    renderButton();
    await openPopover();

    expect(screen.getByText('смета.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Показать в папке' }));
    await waitFor(() => expect(bridge.downloadReveal).toHaveBeenCalledWith(OK.path));
  });

  it('неуспех — бейдж «Не удалось скачать», кнопки показа нет', async () => {
    installBridge([FAILED]);
    renderButton();
    await openPopover();

    expect(screen.getByText('Не удалось скачать')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Показать в папке' })).toBeNull();
  });

  it('пустой реестр — «Пока ничего не скачивали»', async () => {
    installBridge([]);
    renderButton();
    await openPopover();

    expect(screen.getByText('Пока ничего не скачивали')).toBeTruthy();
    expect(screen.queryByText('Показать в папке')).toBeNull();
  });
});
