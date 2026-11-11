import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError, apiUpload } from './api-client.js';
import { useAuthStore } from './auth-store.js';

/** Ответ fetch-заглушки. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Поддельный XHR: статус ответа — из очереди, заголовки запросов копятся. */
class FakeXhr {
  static statuses: number[] = [];
  static sent: { headers: Record<string, string> }[] = [];
  status = 0;
  responseText = '';
  withCredentials = false;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private headers: Record<string, string> = {};
  open() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  abort() {}
  send() {
    FakeXhr.sent.push({ headers: this.headers });
    this.status = FakeXhr.statuses.shift() ?? 500;
    this.responseText =
      this.status === 401 ? JSON.stringify({ code: 'UNAUTHENTICATED' }) : JSON.stringify({ ok: 1 });
    queueMicrotask(() => this.onload?.());
  }
}

describe('api-client', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'old', user: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('успешный ответ: 204 и пустое тело → undefined, JSON → данные', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/no-content')) return new Response(null, { status: 204 });
        if (url.endsWith('/empty')) return new Response('', { status: 200 });
        return jsonResponse(200, { a: 1 });
      }),
    );
    await expect(api('/no-content')).resolves.toBeUndefined();
    await expect(api('/empty', { method: 'POST' })).resolves.toBeUndefined();
    await expect(api('/json')).resolves.toEqual({ a: 1 });
  });

  it('успешный ответ с не-JSON телом → ApiError единого формата, не голый SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200 })),
    );
    const error = await api('/html').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INTERNAL_ERROR');
    expect((error as ApiError).status).toBe(200);
  });

  it('явный bearer: заголовок из опции, а не из стора; 401 не запускает refresh', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => jsonResponse(401, { code: 'UNAUTHENTICATED' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('/auth/me', { bearer: 'fresh' })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer fresh');
  });

  it('apiUpload: повтор после 401-refresh идёт с ТЕМ ЖЕ Idempotency-Key (I7)', async () => {
    FakeXhr.statuses = [401, 200];
    FakeXhr.sent = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { accessToken: 'new', expiresIn: 900, userId: 'A' })),
    );

    await expect(apiUpload('/files', new FormData())).resolves.toEqual({ ok: 1 });

    expect(FakeXhr.sent).toHaveLength(2);
    const [first, second] = FakeXhr.sent;
    expect(first?.headers['Idempotency-Key']).toBeTruthy();
    expect(second?.headers['Idempotency-Key']).toBe(first?.headers['Idempotency-Key']);
    expect(second?.headers.authorization).toBe('Bearer new');
  });

  it('api: тот же аккаунт — повтор после refresh идёт с новым токеном', async () => {
    useAuthStore.setState({ accessToken: 'old', user: { id: 'A' } as never });
    let taskCalls = 0;
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        if (String(input).endsWith('/auth/refresh')) {
          return jsonResponse(200, { accessToken: 'new', expiresIn: 900, userId: 'A' });
        }
        taskCalls += 1;
        return taskCalls === 1
          ? jsonResponse(401, { code: 'UNAUTHENTICATED' })
          : jsonResponse(200, { ok: 1 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/tasks')).resolves.toEqual({ ok: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>;
    expect(retryHeaders.authorization).toBe('Bearer new');
  });

  it('api: смена аккаунта во время refresh — повтор не уходит с чужим токеном (#747)', async () => {
    useAuthStore.setState({ accessToken: 'token-a', user: { id: 'A' } as never });
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        if (String(input).endsWith('/auth/refresh')) {
          // Пока шёл refresh, на этом же браузере вышли из A и вошли в B:
          // refresh-cookie уже B, стор — новый аккаунт.
          useAuthStore.setState({
            status: 'authenticated',
            accessToken: 'token-b',
            user: { id: 'B' } as never,
          });
          return jsonResponse(200, { accessToken: 'token-b', expiresIn: 900, userId: 'B' });
        }
        return jsonResponse(401, { code: 'UNAUTHENTICATED' });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/tasks', { method: 'POST', body: { title: 'A' } })).rejects.toMatchObject({
      status: 401,
    });

    // Только исходный запрос и refresh: повтора с телом A нет.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sentAuth = fetchMock.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)?.authorization,
    );
    expect(sentAuth).not.toContain('Bearer token-b');
  });

  it('apiUpload: смена аккаунта во время refresh — файл не перезаливается (#747)', async () => {
    useAuthStore.setState({ accessToken: 'token-a', user: { id: 'A' } as never });
    FakeXhr.statuses = [401, 200];
    FakeXhr.sent = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal(
      'fetch',
      vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
        if (String(input).endsWith('/auth/refresh')) {
          useAuthStore.setState({
            status: 'authenticated',
            accessToken: 'token-b',
            user: { id: 'B' } as never,
          });
          return jsonResponse(200, { accessToken: 'token-b', expiresIn: 900, userId: 'B' });
        }
        return jsonResponse(401, { code: 'UNAUTHENTICATED' });
      }),
    );

    await expect(apiUpload('/files', new FormData())).rejects.toBeInstanceOf(ApiError);

    expect(FakeXhr.sent).toHaveLength(1);
    expect(FakeXhr.sent[0]?.headers.authorization).toBe('Bearer token-a');
  });

  it('api: refresh-cookie другой вкладки (токен B) — не применяем и не повторяем (#747)', async () => {
    useAuthStore.setState({ accessToken: 'token-a', user: { id: 'A' } as never });
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        if (String(input).endsWith('/auth/refresh')) {
          // Стор этой вкладки по-прежнему A — аккаунт сменили в ДРУГОЙ вкладке,
          // общая refresh-cookie уже принадлежит B.
          return jsonResponse(200, { accessToken: 'token-b', expiresIn: 900, userId: 'B' });
        }
        return jsonResponse(401, { code: 'UNAUTHENTICATED' });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/tasks', { method: 'POST', body: { title: 'A' } })).rejects.toMatchObject({
      status: 401,
    });

    // Только исходный запрос и refresh: повтора с телом A под токеном B нет.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sentAuth = fetchMock.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)?.authorization,
    );
    expect(sentAuth).not.toContain('Bearer token-b');
    // Сессия вкладки A недействительна: чужой токен не применён, нужен вход.
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('apiUpload: refresh-cookie другой вкладки — файл не перезаливается токеном B (#747)', async () => {
    useAuthStore.setState({ accessToken: 'token-a', user: { id: 'A' } as never });
    FakeXhr.statuses = [401, 200];
    FakeXhr.sent = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal(
      'fetch',
      vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
        if (String(input).endsWith('/auth/refresh')) {
          return jsonResponse(200, { accessToken: 'token-b', expiresIn: 900, userId: 'B' });
        }
        return jsonResponse(401, { code: 'UNAUTHENTICATED' });
      }),
    );

    await expect(apiUpload('/files', new FormData())).rejects.toBeInstanceOf(ApiError);

    expect(FakeXhr.sent).toHaveLength(1);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
