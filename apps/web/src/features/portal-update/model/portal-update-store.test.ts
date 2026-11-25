import { afterEach, describe, expect, it, vi } from 'vitest';

import { PORTAL_VERSION } from './portal-version.js';
import { usePortalUpdateStore } from './portal-update-store.js';

/** fetch-заглушка с ответом { ok, json } — как Response для стора. */
function mockFetch(payload: unknown, ok = true): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(payload),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function resetStore(): void {
  usePortalUpdateStore.setState({ latestVersion: null, updateAvailable: false });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetStore();
});

describe('portal-update-store.check (#1038)', () => {
  it('версия на раздаче новее сборки → updateAvailable + latestVersion', async () => {
    mockFetch({ version: '99.0.0' });
    await usePortalUpdateStore.getState().check();
    expect(usePortalUpdateStore.getState().updateAvailable).toBe(true);
    expect(usePortalUpdateStore.getState().latestVersion).toBe('99.0.0');
  });

  it('та же версия, что сборка → тихо без обновления', async () => {
    mockFetch({ version: PORTAL_VERSION });
    await usePortalUpdateStore.getState().check();
    expect(usePortalUpdateStore.getState().updateAvailable).toBe(false);
    expect(usePortalUpdateStore.getState().latestVersion).toBeNull();
  });

  it('версия старее сборки → тихо без обновления', async () => {
    mockFetch({ version: '0.0.1' });
    await usePortalUpdateStore.getState().check();
    expect(usePortalUpdateStore.getState().updateAvailable).toBe(false);
  });

  it('404, битый JSON, обрыв сети и не-строка в version — молча', async () => {
    mockFetch(null, false);
    await usePortalUpdateStore.getState().check();
    expect(usePortalUpdateStore.getState().updateAvailable).toBe(false);

    resetStore();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('битый JSON')) }),
    );
    await usePortalUpdateStore.getState().check();
    expect(usePortalUpdateStore.getState().updateAvailable).toBe(false);

    resetStore();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('сеть')));
    await usePortalUpdateStore.getState().check();
    expect(usePortalUpdateStore.getState().updateAvailable).toBe(false);

    resetStore();
    mockFetch({ version: 7 });
    await usePortalUpdateStore.getState().check();
    expect(usePortalUpdateStore.getState().updateAvailable).toBe(false);
  });

  it('уже найденное обновление не переспрашивается (fetch не зовётся)', async () => {
    usePortalUpdateStore.setState({ updateAvailable: true, latestVersion: '1.0.0' });
    const fetchMock = mockFetch({ version: '99.0.0' });
    await usePortalUpdateStore.getState().check();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(usePortalUpdateStore.getState().latestVersion).toBe('1.0.0');
  });
});
