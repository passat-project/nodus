// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER = 'prefs-user-1';
const apiMock = vi.fn();

vi.mock('../api-client.js', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

describe('ui-prefs-sync: гидратация не затирает неотправленное', () => {
  beforeEach(async () => {
    vi.resetModules();
    apiMock.mockReset();
    localStorage.clear();
    const { useAuthStore } = await import('../auth-store.js');
    useAuthStore.setState({ user: { id: USER } } as never);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dirty-маркер: сервер не читается, локальное досылается PUT', async () => {
    localStorage.setItem(`nodus-ui-prefs-dirty:${USER}`, '1');
    const { useUiPrefsStore } = await import('./ui-prefs-store.js');
    useUiPrefsStore.setState({ personal: { navOrder: ['home', 'tasks'] } });
    apiMock.mockResolvedValue({ preferences: {}, updatedAt: new Date().toISOString() });

    const { startPreferencesSync } = await import('./ui-prefs-sync.js');
    startPreferencesSync();
    await vi.advanceTimersByTimeAsync(600);

    expect(apiMock).not.toHaveBeenCalledWith('/me/preferences');
    expect(apiMock).toHaveBeenCalledWith(
      '/me/preferences',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('без dirty серверный слой применяется и не помечается локальной правкой', async () => {
    apiMock.mockResolvedValue({
      preferences: { navOrder: ['tasks', 'home'] },
      updatedAt: new Date().toISOString(),
    });
    const { useUiPrefsStore } = await import('./ui-prefs-store.js');
    const { startPreferencesSync } = await import('./ui-prefs-sync.js');
    startPreferencesSync();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(useUiPrefsStore.getState().personal.navOrder).toEqual(['tasks', 'home']);
    await vi.advanceTimersByTimeAsync(600);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`nodus-ui-prefs-dirty:${USER}`)).toBeNull();
  });
});
