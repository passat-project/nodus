// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOADS_REGISTRY_LIMIT, type DownloadEntry } from '@nodus/contracts';

import { bindDesktopShellEvents } from './desktop-bridge.js';
import { useDownloadsRegistry } from './use-downloads-registry.js';

/**
 * Реестр загрузок для панели (эпик #1038): стартовый список командой,
 * живые записи событием download-finished (фан-аут bindDesktopShellEvents
 * — как в app-shell), дедуп по id, потолок DOWNLOADS_REGISTRY_LIMIT.
 */

const FIRST = '00000000-0000-4000-8000-0000000000d1';
const SECOND = '00000000-0000-4000-8000-0000000000d2';
const THIRD = '00000000-0000-4000-8000-0000000000d3';

function entry(id: string, overrides: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    id,
    fileName: `файл-${id.slice(-2)}.pdf`,
    path: `C:\\Users\\k\\Downloads\\файл-${id.slice(-2)}.pdf`,
    success: true,
    finishedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

function uuidSequence(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const tail = String(i + 1).padStart(12, '0');
    return `00000000-0000-4000-8000-${tail}`;
  });
}

function installBridge(list: DownloadEntry[]) {
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

function bindShell(): () => void {
  return bindDesktopShellEvents({
    onPopupReply: vi.fn(),
    onOpenConversation: vi.fn(),
    onOpenLetter: vi.fn(),
  });
}

beforeEach(() => {
  delete window.nodusDesktop;
});

afterEach(() => {
  cleanup();
  delete window.nodusDesktop;
});

describe('useDownloadsRegistry', () => {
  it('вне оболочки: пустой готовый реестр, команда не зовётся', async () => {
    const { result } = renderHook(() => useDownloadsRegistry());
    expect(result.current.entries).toEqual([]);
    expect(result.current.ready).toBe(true);
    await expect(result.current.reveal('C:\\x.pdf')).resolves.toBe(false);
  });

  it('стартовый список из оболочки — как отдал мост (новые первыми)', async () => {
    installBridge([entry(SECOND), entry(FIRST)]);
    const { result } = renderHook(() => useDownloadsRegistry());
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entries.map((e) => e.id)).toEqual([SECOND, FIRST]);
  });

  it('событие download-finished: новая запись наверх', async () => {
    const { emit } = installBridge([]);
    const unbind = bindShell();
    const { result } = renderHook(() => useDownloadsRegistry());
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => emit('download-finished', entry(THIRD)));
    expect(result.current.entries.map((e) => e.id)).toEqual([THIRD]);

    act(() => emit('download-finished', entry(SECOND)));
    expect(result.current.entries.map((e) => e.id)).toEqual([SECOND, THIRD]);

    unbind();
  });

  it('дедуп по id: повтор записи поднимает её наверх, не дублирует', async () => {
    const { emit } = installBridge([entry(SECOND), entry(FIRST)]);
    const unbind = bindShell();
    const { result } = renderHook(() => useDownloadsRegistry());
    await waitFor(() => expect(result.current.entries.length).toBe(2));

    act(() => emit('download-finished', { ...entry(FIRST), finishedAtMs: 1_700_000_060_000 }));
    expect(result.current.entries.map((e) => e.id)).toEqual([FIRST, SECOND]);
    expect(result.current.entries.length).toBe(2);

    unbind();
  });

  it('потолок реестра: старейшие вытесняются (зеркало оболочки)', async () => {
    const ids = uuidSequence(DOWNLOADS_REGISTRY_LIMIT + 5);
    installBridge(ids.map((id) => entry(id)));
    const { result } = renderHook(() => useDownloadsRegistry());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entries.length).toBe(DOWNLOADS_REGISTRY_LIMIT);
    expect(result.current.entries[0]?.id).toBe(ids[0]);
  });

  it('reveal вызывает мост downloadReveal с путём записи', async () => {
    const { bridge } = installBridge([]);
    const { result } = renderHook(() => useDownloadsRegistry());
    await act(async () => {
      expect(await result.current.reveal('C:\\Downloads\\смета.pdf')).toBe(true);
    });
    expect(bridge.downloadReveal).toHaveBeenCalledWith('C:\\Downloads\\смета.pdf');
  });
});
