// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindDesktopShellEvents,
  desktopDownloadReveal,
  desktopDownloadsList,
  registerDownloadsListener,
} from './desktop-bridge.js';

/**
 * Команды реестра загрузок и живое событие download-finished (эпик #1038):
 * zod-фильтр на границе, null/ложь вне оболочки и у старой оболочки,
 * фан-аут валидной записи слушателям registerDownloadsListener.
 */

const DOWNLOAD_PATH = 'C:\\Users\\k\\Downloads\\смета.pdf';
const DOWNLOAD_ENTRY = {
  id: '00000000-0000-4000-8000-0000000000d1',
  fileName: 'смета.pdf',
  path: DOWNLOAD_PATH,
  success: true,
  finishedAtMs: 1_700_000_000_000,
};

function installBridge() {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const bridge = {
    shellVersion: '1.0.0',
    platform: 'windows',
    downloadsList: vi.fn(async () => [DOWNLOAD_ENTRY]),
    downloadReveal: vi.fn(async () => undefined),
    shellReady: vi.fn(async () => undefined),
    onEvent: vi.fn((type: string, fn: (payload: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
      return () => {
        const cur = listeners.get(type) ?? [];
        listeners.set(
          type,
          cur.filter((f) => f !== fn),
        );
      };
    }),
  };
  window.nodusDesktop = bridge as unknown as typeof window.nodusDesktop;
  const emit = (type: string, payload: unknown) =>
    (listeners.get(type) ?? []).forEach((fn) => fn(payload));
  return { bridge, emit };
}

beforeEach(() => {
  delete window.nodusDesktop;
});

afterEach(() => {
  delete window.nodusDesktop;
});

describe('команды реестра (эпик #1038)', () => {
  it('браузер и старая оболочка без команды: список — null, reveal — ложь', async () => {
    expect(await desktopDownloadsList()).toBeNull();
    expect(await desktopDownloadReveal(DOWNLOAD_PATH)).toBe(false);

    installBridge();
    const bridge = window.nodusDesktop as unknown as Record<string, unknown>;
    delete bridge.downloadsList;
    delete bridge.downloadReveal;
    expect(await desktopDownloadsList()).toBeNull();
    expect(await desktopDownloadReveal(DOWNLOAD_PATH)).toBe(false);
  });

  it('список парсится контрактом; кривой payload и сбой моста — null', async () => {
    const { bridge } = installBridge();
    expect(await desktopDownloadsList()).toEqual([DOWNLOAD_ENTRY]);

    bridge.downloadsList.mockResolvedValue([{ ...DOWNLOAD_ENTRY, fileName: '' }]);
    expect(await desktopDownloadsList()).toBeNull();

    bridge.downloadsList.mockRejectedValue(new Error('bridge gone'));
    expect(await desktopDownloadsList()).toBeNull();
  });

  it('reveal: успех — истина, отказ Rust — ложь', async () => {
    const { bridge } = installBridge();
    expect(await desktopDownloadReveal(DOWNLOAD_PATH)).toBe(true);
    expect(bridge.downloadReveal).toHaveBeenCalledWith(DOWNLOAD_PATH);

    bridge.downloadReveal.mockRejectedValue('not_found');
    expect(await desktopDownloadReveal(DOWNLOAD_PATH)).toBe(false);
  });
});

describe('событие download-finished (эпик #1038)', () => {
  it('валидная запись — всем слушателям, мусор фильтруется, отписка работает', () => {
    const { emit } = installBridge();
    const onEntry = vi.fn();
    const unregister = registerDownloadsListener(onEntry);
    const unbind = bindDesktopShellEvents({
      onPopupReply: vi.fn(),
      onOpenConversation: vi.fn(),
      onOpenLetter: vi.fn(),
    });

    emit('download-finished', DOWNLOAD_ENTRY);
    emit('download-finished', { ...DOWNLOAD_ENTRY, id: 'не-uuid' });
    expect(onEntry).toHaveBeenCalledTimes(1);
    expect(onEntry).toHaveBeenCalledWith(DOWNLOAD_ENTRY);

    unregister();
    emit('download-finished', { ...DOWNLOAD_ENTRY, id: '00000000-0000-4000-8000-0000000000d2' });
    expect(onEntry).toHaveBeenCalledTimes(1);

    unbind();
  });

  it('два слушателя получают одну запись (панель подписана независимо)', () => {
    const { emit } = installBridge();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registerDownloadsListener(first);
    const offSecond = registerDownloadsListener(second);
    const unbind = bindDesktopShellEvents({
      onPopupReply: vi.fn(),
      onOpenConversation: vi.fn(),
      onOpenLetter: vi.fn(),
    });

    emit('download-finished', DOWNLOAD_ENTRY);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    offFirst();
    offSecond();
    unbind();
  });
});
