import { create } from 'zustand';
import type { AuthTokens, AuthUser } from '@nodus/contracts';

import { api, ApiError } from './api-client.js';

type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  user: AuthUser | null;
  /** Логин: токены + карточка me. */
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Прозрачное обновление access по refresh-cookie; false — обновить не
   *  удалось (сессия мертва ИЛИ сервер недоступен — см. isSessionDead). */
  tryRefresh: () => Promise<boolean>;
  /** Стартовый bootstrap: есть ли живая сессия. */
  bootstrap: () => Promise<void>;
}

/**
 * Auth-состояние SPA (zustand): access-токен только в памяти (не localStorage —
 * защита от XSS-угона), refresh — httpOnly-cookie на стороне API.
 */

/** Дедупликация параллельных refresh: один in-flight запрос на всех
 * (пакет 401 после простоя, retry React Query). Серверный reuse-detection
 * иначе отозвал бы сессию при двух refresh с одной cookie. */
let refreshInFlight: Promise<boolean> | null = null;

/** Дедуп параллельных bootstrap (гарды /login и оболочки, повторный
 *  beforeLoad после invalidate): один /auth/refresh + /auth/me на всех. */
let bootstrapInFlight: Promise<void> | null = null;

/** Сессия МЕРТВА — только ответ сервера 401 (AUTH_SESSION_INVALID /
 *  UNAUTHENTICATED). Обрыв сети (ApiError status 0 / TypeError fetch), 5xx,
 *  429 — сервер недоступен, а не сессия: выкидывать на /login нельзя
 *  (живая cookie осталась, следующий запрос обновит токен сам). */
function isSessionDead(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

const ANONYMOUS = { status: 'anonymous', accessToken: null, user: null } as const;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'unknown',
  accessToken: null,
  user: null,

  async login(email, password) {
    const tokens = await api<AuthTokens>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    // Атомарно: токен попадает в стор ВМЕСТЕ с карточкой me — упавший /auth/me
    // не оставляет «полувход» (токен без пользователя и статуса).
    const user = await api<AuthUser>('/auth/me', { bearer: tokens.accessToken });
    set({ status: 'authenticated', accessToken: tokens.accessToken, user });
  },

  async logout() {
    try {
      await api('/auth/logout', { method: 'POST', auth: false });
    } finally {
      set(ANONYMOUS);
    }
  },

  async tryRefresh() {
    refreshInFlight ??= (async () => {
      const actorId = get().user?.id ?? null;
      try {
        const tokens = await api<AuthTokens>('/auth/refresh', { method: 'POST', auth: false });
        // Пока шёл refresh, сессию сменили в этой вкладке — чужой ответ не
        // применяем: вход/выход уже поставил актуальное состояние.
        if ((get().user?.id ?? null) !== actorId) return false;
        // Refresh-cookie общая на браузер: в другой вкладке могли выйти из A
        // и войти в B — сервер вернёт токен B. Токен чужого аккаунта не
        // применяем, сессию этой вкладки считаем мёртвой (#747).
        if (actorId !== null && tokens.userId !== actorId) {
          set(ANONYMOUS);
          return false;
        }
        set({ accessToken: tokens.accessToken });
        return true;
      } catch (error) {
        // Анонимом делает только мёртвая сессия; при недоступном сервере
        // статус не трогаем (обрыв сети не выкидывает на /login).
        if (isSessionDead(error)) set(ANONYMOUS);
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },

  async bootstrap() {
    if (get().status !== 'unknown') return;
    bootstrapInFlight ??= (async () => {
      try {
        const alive = await get().tryRefresh();
        // Не обновили: мёртвая сессия → tryRefresh уже поставил anonymous;
        // сервер недоступен → статус остаётся 'unknown' (гард оболочки
        // показывает экран ошибки, следующий заход повторит bootstrap).
        if (!alive) return;
        try {
          const user = await api<AuthUser>('/auth/me');
          set({ status: 'authenticated', user });
        } catch (error) {
          set(
            isSessionDead(error) ? ANONYMOUS : { status: 'unknown', accessToken: null, user: null },
          );
        }
      } finally {
        bootstrapInFlight = null;
      }
    })();
    return bootstrapInFlight;
  },
}));
