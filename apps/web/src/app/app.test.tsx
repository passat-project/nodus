import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../shared/auth-store.js';

/** Ответ fetch-заглушки. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const USER = {
  id: '7b0a2c2e-9a9a-4b1c-9c9c-0a1b2c3d4e5f',
  email: 'admin@nodus.by',
  displayName: 'Администратор Системный',
  permissions: ['directory.read'],
};

const TOKENS = { accessToken: 'access-jwt', expiresIn: 900, userId: USER.id };

describe('auth-store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ status: 'unknown', accessToken: null, user: null });
  });

  it('login: токены → me → authenticated', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/auth/login')) return jsonResponse(200, TOKENS);
        if (url.endsWith('/auth/me')) return jsonResponse(200, USER);
        return jsonResponse(404, { code: 'NOT_FOUND' });
      }),
    );

    await useAuthStore.getState().login('admin@nodus.by', 'secret');

    const state = useAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.accessToken).toBe('access-jwt');
    expect(state.user?.displayName).toBe('Администратор Системный');
    expect(calls.map((c) => c.split('/api/v1')[1])).toEqual(['/auth/login', '/auth/me']);
  });

  it('bootstrap: живая refresh-cookie → authenticated; мёртвая → anonymous', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/refresh')) return jsonResponse(200, TOKENS);
        if (url.endsWith('/auth/me')) return jsonResponse(200, USER);
        return jsonResponse(404, {});
      }),
    );
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe('authenticated');

    useAuthStore.setState({ status: 'unknown', accessToken: null, user: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { code: 'AUTH_SESSION_INVALID', message: 'x' })),
    );
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('параллельные tryRefresh дедуплицируются в один запрос (гонка после 401)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, TOKENS));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b, c] = await Promise.all([
      useAuthStore.getState().tryRefresh(),
      useAuthStore.getState().tryRefresh(),
      useAuthStore.getState().tryRefresh(),
    ]);

    expect(a && b && c).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tryRefresh: обрыв сети и 5xx НЕ делают анонимом (не выкидывает на /login); 401 — делает', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(useAuthStore.getState().tryRefresh()).resolves.toBe(false);
    expect(useAuthStore.getState().status).toBe('authenticated');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(503, { code: 'INTERNAL_ERROR' })),
    );
    await expect(useAuthStore.getState().tryRefresh()).resolves.toBe(false);
    expect(useAuthStore.getState().status).toBe('authenticated');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { code: 'AUTH_SESSION_INVALID', message: 'x' })),
    );
    await expect(useAuthStore.getState().tryRefresh()).resolves.toBe(false);
    expect(useAuthStore.getState().status).toBe('anonymous');
  });

  it('tryRefresh: refresh отдал токен другого аккаунта — не применяем, сессия мертва (#747)', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'token-a', user: USER });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, {
          accessToken: 'token-b',
          expiresIn: 900,
          userId: '00000000-0000-4000-8000-000000000002',
        }),
      ),
    );

    await expect(useAuthStore.getState().tryRefresh()).resolves.toBe(false);

    const state = useAuthStore.getState();
    expect(state.status).toBe('anonymous');
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
  });

  it('tryRefresh: тот же аккаунт — токен применяется', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'token-old', user: USER });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { ...TOKENS, accessToken: 'token-new' })),
    );

    await expect(useAuthStore.getState().tryRefresh()).resolves.toBe(true);

    expect(useAuthStore.getState().accessToken).toBe('token-new');
    expect(useAuthStore.getState().user?.id).toBe(USER.id);
  });

  it('bootstrap: сервер недоступен на старте → статус остаётся unknown (повтор на следующем заходе)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe('unknown');
  });

  it('bootstrap: параллельные вызовы (гарды) — один /auth/refresh и один /auth/me', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) return jsonResponse(200, TOKENS);
      return jsonResponse(200, USER);
    });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([useAuthStore.getState().bootstrap(), useAuthStore.getState().bootstrap()]);

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('login: упавший /auth/me не оставляет токен в сторе (вход атомарен)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/auth/login')) return jsonResponse(200, TOKENS);
        // /auth/me получает токен явным заголовком, не из стора.
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.authorization).toBe('Bearer access-jwt');
        return jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'x' });
      }),
    );

    await expect(useAuthStore.getState().login('admin@nodus.by', 'secret')).rejects.toThrow();
    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.status).toBe('unknown');
  });

  it('logout: сбрасывает состояние даже при ошибке сети', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('network down'))),
    );

    await expect(useAuthStore.getState().logout()).rejects.toThrow('network down');
    expect(useAuthStore.getState().status).toBe('anonymous');
  });
});
