import { useAuthStore } from './auth-store.js';
import { getApiMockConfig, isDomainMocked, type ApiMockDomain } from './api/api-mock-config.js';

/**
 * HTTP-клиент SPA: Bearer access-токен из auth-store, единый повтор
 * запроса после прозрачного refresh (cookie httpOnly — JS её не видит).
 * Ошибки API — единый формат { code, message, details?, traceId }
 * (traceId — корреляция с серверными логами, I7).
 * Каждая мутация идемпотентна (I7): POST/PATCH/DELETE автоматически несут
 * заголовок Idempotency-Key (uuid на ВЫЗОВ api) — повтор после refresh идёт
 * с ТЕМ ЖЕ ключом, бэкенд дедуплицирует ретраи/двойные клики. MSW-хендлеры
 * заголовок игнорируют.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** false — без Bearer (login/refresh). */
  auth?: boolean;
  /** Явный access-токен вместо стора (login: /auth/me ДО записи токена в
   *  стор — вход атомарен). С явным токеном прозрачного refresh нет: повтор
   *  ушёл бы с тем же отвергнутым токеном. */
  bearer?: string;
  /** Явный ключ идемпотентности — когда один ЛОГИЧЕСКИЙ запрос шлётся
   *  несколькими вызовами (ручной retry той же операции). По умолчанию
   *  генерируется на вызов. */
  idempotencyKey?: string;
  /** Отмена in-flight запроса (черновики: последняя попытка выигрывает, #91). */
  signal?: AbortSignal;
  /** fetch keepalive: запрос доживёт закрытие вкладки (flush черновика на
   *  pagehide без него терялся — «залипшая» метка, #132). */
  keepalive?: boolean;
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Актёр на старте логического запроса. Прозрачный повтор после refresh
 *  допустим только в той же сессии: иначе тело мутации аккаунта A уйдёт с
 *  токеном аккаунта B, если между 401 и refresh на этом же браузере успели
 *  выйти из A и войти в B (refresh-cookie уже B) — security-аудит #747. */
function sessionActorId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const accessToken = options.bearer ?? useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (options.auth !== false && accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (MUTATION_METHODS.has(options.method ?? 'GET')) {
    headers['Idempotency-Key'] = options.idempotencyKey ?? crypto.randomUUID();
  }
  return fetch(`/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin', // refresh-cookie nodus_refresh
    signal: options.signal,
    keepalive: options.keepalive,
  });
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Ключ идемпотентности резолвится ОДИН раз на логический вызов (#48):
  // прозрачный refresh внутри api() повторяет запрос с тем же ключом
  // (как и обещает шапка файла), иначе бэкенд не сведёт retry в одну мутацию.
  const resolved =
    MUTATION_METHODS.has(options.method ?? 'GET') && !options.idempotencyKey
      ? { ...options, idempotencyKey: crypto.randomUUID() }
      : options;
  const actorId = sessionActorId();
  let response = await rawRequest(path, resolved);

  // Access протух → один прозрачный refresh и повтор (I4: без спиннеров).
  // Сменился аккаунт — не повторяем: запрос принадлежит прежней сессии.
  if (response.status === 401 && resolved.auth !== false && resolved.bearer === undefined) {
    const refreshed = await useAuthStore.getState().tryRefresh();
    if (refreshed && sessionActorId() === actorId) {
      response = await rawRequest(path, resolved);
    }
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      code?: string;
      message?: string;
      details?: Record<string, unknown>;
      traceId?: string;
    } | null;
    throw new ApiError(
      errorBody?.code ?? 'INTERNAL_ERROR',
      errorBody?.message ?? `HTTP ${response.status}`,
      response.status,
      errorBody?.details,
      errorBody?.traceId,
    );
  }
  return readSuccessBody<T>(response);
}

/** Тело успешного ответа: 204 и пустое тело — undefined (как у загрузок);
 *  не-JSON (HTML заглушки прокси, обрезанный ответ) — ApiError единого
 *  формата, а не голый SyntaxError мимо обработчиков `instanceof ApiError`. */
async function readSuccessBody<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text().catch(() => null);
  if (text === null) {
    throw new ApiError('INTERNAL_ERROR', 'Response body unreadable', response.status);
  }
  if (text.trim() === '') {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('INTERNAL_ERROR', 'Invalid JSON response', response.status);
  }
}

interface UploadOptions {
  /** Доля 0..1 — для индикатора прогресса (XHR upload.onprogress). */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  idempotencyKey?: string;
  /** Домен загрузки: в ПОЛУМОК-режиме (MSW активен, домен живой) XHR-перехват
   *  MSW искажает большие multipart-тела (repro #57: 3 МБ JPEG → network
   *  error/400; 100-байтовый PNG проходит) — грузим fetch-ом мимо
   *  перехватчика через msw bypass(). Реальный прогресс недоступен — вызывающий
   *  уже держит таймер-пол. Демо (домен в моках) и полный live — без изменений. */
  mswBypassIfLive?: ApiMockDomain;
}

function xhrUpload<T>(path: string, form: FormData, options: UploadOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1${path}`);
    const { accessToken } = useAuthStore.getState();
    if (accessToken) xhr.setRequestHeader('authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('Idempotency-Key', options.idempotencyKey ?? crypto.randomUUID());
    xhr.withCredentials = true; // refresh-cookie nodus_refresh
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 204) {
        resolve(undefined as T);
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined; // не-JSON ответ (напр. обрыв соединения)
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const errorBody = body as {
        code?: string;
        message?: string;
        details?: Record<string, unknown>;
        traceId?: string;
      } | null;
      reject(
        new ApiError(
          errorBody?.code ?? 'INTERNAL_ERROR',
          errorBody?.message ?? `HTTP ${xhr.status}`,
          xhr.status,
          errorBody?.details,
          errorBody?.traceId,
        ),
      );
    };
    xhr.onerror = () => reject(new ApiError('INTERNAL_ERROR', 'Network error', 0));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/** Загрузка мимо MSW-перехватчика (msw bypass()): полумок-режим — домен
 *  живой, но воркер активен из-за других доменов. Request строится НА каждый
 *  заход (тело Request одноразовое — прозрачный refresh повторяет свежим). */
async function bypassUpload<T>(path: string, form: FormData, options: UploadOptions): Promise<T> {
  const { bypass } = await import('msw');
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const actorId = sessionActorId();
  const build = () => {
    const { accessToken } = useAuthStore.getState();
    const headers: Record<string, string> = { 'Idempotency-Key': idempotencyKey };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    return new Request(`/api/v1${path}`, { method: 'POST', body: form, headers });
  };
  let response = await fetch(bypass(build()), { signal: options.signal });
  if (response.status === 401) {
    const refreshed = await useAuthStore.getState().tryRefresh();
    if (refreshed && sessionActorId() === actorId) {
      response = await fetch(bypass(build()), { signal: options.signal });
    }
  }
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (response.status >= 200 && response.status < 300) return body as T;
  const errorBody = body as {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    traceId?: string;
  } | null;
  throw new ApiError(
    errorBody?.code ?? 'INTERNAL_ERROR',
    errorBody?.message ?? `HTTP ${response.status}`,
    response.status,
    errorBody?.details,
    errorBody?.traceId,
  );
}

/** Загрузка файла (multipart) — единый HTTP-контур проекта (patterns.md):
 *  тот же auth/refresh/Idempotency-Key, но XHR ради событий прогресса
 *  (fetch upload-progress не умеет). 401 → один прозрачный refresh и повтор. */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  options: UploadOptions = {},
): Promise<T> {
  // Ключ идемпотентности — ОДИН на логическую загрузку (как в api()):
  // повтор после прозрачного refresh идёт с тем же ключом, иначе бэкенд
  // принял бы ретрай за вторую загрузку (дубль вложения).
  const resolved: UploadOptions = {
    ...options,
    idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
  };
  const actorId = sessionActorId();
  if (
    resolved.mswBypassIfLive !== undefined &&
    getApiMockConfig().enabled &&
    !isDomainMocked(resolved.mswBypassIfLive)
  ) {
    return bypassUpload<T>(path, form, resolved);
  }
  try {
    return await xhrUpload<T>(path, form, resolved);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const refreshed = await useAuthStore.getState().tryRefresh();
      if (refreshed && sessionActorId() === actorId) return xhrUpload<T>(path, form, resolved);
    }
    throw error;
  }
}

/** Результат чтения текста по подписанной ссылке (тело письма, #55 Р9). */
