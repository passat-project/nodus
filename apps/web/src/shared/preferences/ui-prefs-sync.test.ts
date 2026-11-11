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

  it('локальная правка во время GET не затирается ответом', async () => {
    let resolveGet: ((value: unknown) => void) | undefined;
    apiMock.mockImplementation((path: string, init?: { method?: string }) =>
      path === '/me/preferences' && !init
        ? new Promise((resolve) => {
            resolveGet = resolve;
          })
        : Promise.resolve({ preferences: {}, updatedAt: new Date().toISOString() }),
    );
    const { useUiPrefsStore } = await import('./ui-prefs-store.js');
    const { startPreferencesSync } = await import('./ui-prefs-sync.js');
    startPreferencesSync();
    await Promise.resolve();

    useUiPrefsStore.getState().applyNav(['local'], [], false);
    resolveGet?.({ preferences: { navOrder: ['server'] }, updatedAt: new Date().toISOString() });
    await vi.advanceTimersByTimeAsync(0);

    expect(useUiPrefsStore.getState().personal.navOrder).toEqual(['local']);
  });

  it('смена пользователя: кэш нового аккаунта не уходит PUT и не стирает сервер', async () => {
    apiMock.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === 'PUT'
        ? Promise.resolve({ preferences: {}, updatedAt: new Date().toISOString() })
        : Promise.resolve({
            preferences: { navOrder: ['server'] },
            updatedAt: new Date().toISOString(),
          }),
    );
    const { useAuthStore } = await import('../auth-store.js');
    const { useUiPrefsStore } = await import('./ui-prefs-store.js');
    const { startPreferencesSync } = await import('./ui-prefs-sync.js');
    startPreferencesSync();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(useUiPrefsStore.getState().personal.navOrder).toEqual(['server']);

    useAuthStore.setState({ user: { id: 'prefs-user-2' } } as never);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(useUiPrefsStore.getState().personal.navOrder).toEqual(['server']);
    const puts = apiMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(puts).toHaveLength(0);
    expect(
      apiMock.mock.calls.filter(([path, init]) => path === '/me/preferences' && !init),
    ).toHaveLength(2);
  });
});
