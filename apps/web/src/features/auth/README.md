# Фича «Аутентификация» (auth)

Экран входа и сессионный контур портала. Тонкая фича: логика сессии живёт
в shared (`auth-store`, `api-client` — канон в `docs/architecture/patterns.md`,
раздел «Фронтенд»), здесь — только страница и моки.

## Состав

- `pages/login-page.tsx` — форма входа (простая форма по канону: useState +
  нативная валидация email; ошибки — из `errorMessages` по коду ApiError).
- `api/mocks/auth-handlers.ts` — MSW: login (zod `loginSchema`), refresh,
  me, logout; демо-сессия любыми валидными по форме данными, logout ставит
  cookie-метку `dead` (экран входа в демо работает честно).

## Контракты (packages/contracts/auth)

`loginSchema`, `authTokensSchema`, `changePasswordSchema`, `sessionInfoSchema`.
Политика паролей — `passwordSchema` (12+, регистры, цифра, спецсимвол;
хэширование на бэке — навык auth-password-hashing, Argon2id).

## Поток сессии (кратко; канон — patterns.md)

login → access в память (`auth-store`, не localStorage) + refresh httpOnly-cookie
`nodus_refresh` → `bootstrap` при старте SPA (живой refresh = молчаливый вход) →
401 на любом запросе = один прозрачный refresh с дедупом параллельных вызовов
(`refreshInFlight`) → повтор запроса, только если ответ refresh выпущен тому же
аккаунту (`userId` в контракте; иначе токен не применяется, сессия вкладки
мертва — вход заново, #747). Logout → 204 + cookie `dead`, стор чистится.

## Лимиты

- Запоминания «остаться в системе» нет — сессия ровно refresh-cookie (MVP).
- Смена пароля и «Мои сессии» — контракты готовы, UI — с бэкендом auth.
