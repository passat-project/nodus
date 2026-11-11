import { http, HttpResponse } from 'msw';
import { loginSchema, updateUserPreferencesBodySchema, type UiPreferences } from '@nodus/contracts';

import {
  demoActorFor,
  mockSessionEmail,
  rememberMockLogin,
  resetMockLogin,
} from '../../../../shared/mocks/mock-actor.js';

const tokens = { accessToken: 'mock-access-token', expiresIn: 900 };
const COOKIE = 'nodus_refresh';
/** Личные настройки демо-сессии (#745): живут в памяти воркера; logout
 *  сбрасывает, чтобы демо-вход начинался с чистого листа. */
let mockPreferences: UiPreferences = {};
let mockPreferencesUpdatedAt = new Date(0).toISOString();

function isDead(request: Request): boolean {
  return request.headers.get('cookie')?.includes(`${COOKIE}=dead`) ?? false;
}

/**
 * MSW-слой auth (ADR-0001): демо-сессия любыми данными; logout убивает сессию
 * cookie-меткой, чтобы в демо работали «Выйти» и экран входа. Тела мутаций
 * валидируются zod-схемами contracts (мок ≠ контракту = баг; refresh/logout —
 * без тела, валидировать нечего).
 *
 * С #432 (Р14) вход по e-mail демо-сотрудника (`user1…user10@passatproekt.by`)
 * выбирает актёра моков: `/auth/me` и хендлеры отвечают от его имени, права —
 * из демо-ролей. Пароль в демо любой.
 */
export const authHandlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Invalid credentials shape' },
        { status: 400 },
      );
    rememberMockLogin(parsed.data.email);
    return HttpResponse.json(tokens, { headers: { 'Set-Cookie': `${COOKIE}=alive; Path=/` } });
  }),

  http.post('/api/v1/auth/refresh', ({ request }) =>
    isDead(request)
      ? HttpResponse.json(
          { code: 'AUTH_SESSION_INVALID', message: 'Session invalid' },
          { status: 401 },
        )
      : HttpResponse.json(tokens, { headers: { 'Set-Cookie': `${COOKIE}=alive; Path=/` } }),
  ),

  http.get('/api/v1/auth/me', ({ request }) =>
    isDead(request)
      ? HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'Unauthenticated' }, { status: 401 })
      : HttpResponse.json(demoActorFor(mockSessionEmail())),
  ),

  http.post('/api/v1/auth/logout', () => {
    resetMockLogin();
    mockPreferences = {};
    mockPreferencesUpdatedAt = new Date(0).toISOString();
    return new HttpResponse(null, {
      status: 204,
      headers: { 'Set-Cookie': `${COOKIE}=dead; Path=/` },
    });
  }),

  http.get('/api/v1/me/preferences', () =>
    HttpResponse.json({ preferences: mockPreferences, updatedAt: mockPreferencesUpdatedAt }),
  ),

  http.put('/api/v1/me/preferences', async ({ request }) => {
    const parsed = updateUserPreferencesBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        { code: 'VALIDATION_FAILED', message: 'Invalid preferences shape' },
        { status: 400 },
      );
    }
    mockPreferences = parsed.data.preferences;
    mockPreferencesUpdatedAt = new Date().toISOString();
    return HttpResponse.json({ preferences: mockPreferences, updatedAt: mockPreferencesUpdatedAt });
  }),
];
