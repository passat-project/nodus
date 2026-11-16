# Модуль auth (ядро)

Логин, JWT/refresh, сессии. Аутентификация — глобальный `JwtAuthGuard`
(default-deny, I8): закрыто всё, кроме `@Public()` (health, `/auth/login`, `/auth/refresh`, `/auth/logout`).

## Контракты (`@nodus/contracts`)

`loginSchema`, `authTokensSchema`, `changePasswordSchema`, `sessionInfoSchema`, `AuthUser`, `Permission`.

## Эндпоинты (`/api/v1/auth`)

| Метод  | Маршрут            | Доступ          | Назначение                                                                               |
| ------ | ------------------ | --------------- | ---------------------------------------------------------------------------------------- |
| POST   | `/login`           | public          | email (без учёта регистра и крайних пробелов, #321)+пароль → access-JWT + refresh-cookie |
| POST   | `/refresh`         | public (cookie) | ротация refresh, новый access                                                            |
| POST   | `/logout`          | public (cookie) | отзыв текущей сессии (идемпотентен)                                                      |
| POST   | `/logout-all`      | auth            | отзыв всех сессий                                                                        |
| GET    | `/me`              | auth            | AuthUser (перечитывается из БД — свежие права/статус) + `modules` (включённые фичефлаги) |
| GET    | `/sessions`        | auth            | активные сессии (current помечена)                                                       |
| DELETE | `/sessions/:id`    | auth            | отзыв чужой сессии (текущую — только logout)                                             |
| POST   | `/change-password` | auth            | проверка старого; отзыв остальных сессий                                                 |

## Механика

- **Права — из порта ролей** (#379, ADR-0034 п. 4): `IdentityLoader` (`identity.loader.ts`) собирает профиль из `AuthRepository.findProfileById` и права из `ROLE_MEMBERSHIP_READER` (прямые роли ∪ роли управленческого подразделения и всех предков). Это единственный источник прав для входа (`LocalAuthProvider`), `refresh` и `/auth/me` — прямой join по `user_roles` в auth не собирается, иначе роль, выданная подразделению, не действовала бы на его сотрудников.
- **Модули в карточке** (Р14 #52): `/auth/me` добавляет `modules` — ключи включённых фичефлагов (`FeatureFlagService.enabledModules`). Веб по этому списку не зовёт маршруты выключенного модуля (`projects-available`); в JWT список не кладётся (смена флага видна без перелогина).
- **Пароли**: Argon2id (RFC 9106: 64 MiB / t=3 / p=4) через core `PasswordService`; `needsRehash` — прозрачный апгрейд при логине; dummy-hash против user-enumeration; политика 12+ символов (zod в contracts).
- **Access-JWT**: 15 мин (`JWT_ACCESS_TTL_SECONDS`), payload = AuthUser + `sid`; stateless + **стоп-лист уволенных** (`revoked-users.store.ts`, #333): событие деактивации пишет в Redis `nodus:auth:revoked-before:<userId>` = момент деактивации + 5 с запаса (гонка refresh до коммита; TTL = TTL access + 60 с; запись только вперёд — Lua max: повтор старого события не откатывает более позднее увольнение), `JwtAuthGuard` отвергает токены с `iat` не позже этого момента — уволенный теряет доступ к API сразу (≈ задержка доставки outbox), а не через 15 мин. Тот же стоп-лист отзывается при смене состава роли или её прав и при смене ролей/подразделения сотрудника (#866, AUD-002). Недоступный Redis: проверка — fail-open (Redis не `ready` → сразу пропуск, завис → таймаут 300 мс; warn не чаще раза в минуту), окно возвращается к TTL токена, API не встаёт; запись — ошибка, диспетчер повторит событие. Повторная активация снятия записи не требует (кроме первых 5 с — один 401 и refresh). Стоп-листом осознанно не покрыты: `/api/docs` (только схема), уже выданные подписанные ссылки на файлы (до своего `exp`), открытая сессия редактора OnlyOffice (подписана на 24 ч — #356).
- **Refresh**: opaque-токен 30 дней в httpOnly-cookie `nodus_refresh` (path `/api/v1/auth`, SameSite=Lax, Secure в production). Формат `<sessionId>.<token>` — поиск сессии по PK. В БД только SHA-256 хэши (текущий + предыдущий).
- **Ротация с reuse-detection**: предъявление предыдущего (сменённого) токена ПОСЛЕ leeway-окна 10 с = компрометация → отзыв всей сессии + аудит `auth.session_reuse_detected` (подход Auth0). В пределах окна — гонка параллельных refresh (мультитаб/ретрай), ротируем штатно; SPA дополнительно дедуплицирует refresh одним in-flight запросом. Сама ротация — атомарный compare-and-swap (`rotateSessionIfCurrent`: один `UPDATE … WHERE refresh_token_hash = <ожидаемый> AND revoked_at IS NULL`): из двух параллельных refresh одной cookie (две вкладки) ротирует ровно один, проигравший перечитывает сессию — его токен теперь «предыдущий» в leeway — и ротирует поверх выигравшего (до 3 попыток), а не затирает его хэш и не выбивает вкладку.
- **Брутфорс-защита**: пер-аккаунтный счётчик неудач в Redis (`LoginThrottleService`, 10 неудач / 10 минут, сброс при успехе) — устойчив к NAT офиса; ответ не выдаёт факт блокировки (тот же `AUTH_INVALID_CREDENTIALS`), аудит `auth.login_throttled`. Недоступный Redis — fail-open (не `ready` → пропуск, завис → таймаут 300 мс; warn не чаще раза в минуту): вход не встаёт, защита временно ослаблена; INCR+EXPIRE — одним Lua-скриптом, иначе сбой между командами оставил бы вечную блокировку. Принятый трейдофф OWASP: lockout-DoS — злоумышленник может держать чужую учётку на паузе, зная email (смягчение: окно 10 минут, без накопления). Плюс базовый rate-limit 300/мин по IP (main.ts, в `NODE_ENV=test` выключен).
- **Смена пароля**: отзывает все сессии, кроме текущей (по refresh-cookie; запрос без cookie считается «без текущей» — отзовутся все).
- **Аудит**: `auth.login` / `auth.login_failed` (из сервиса, с email) / `auth.logout*`, `auth.change_password`, `auth.session_revoke`.

## События

- Подписчик `directory.user.deactivated` (`events/user-deactivated.handler.ts`) — стоп-лист access-токенов (момент = `createdAt` события) и отзыв всех сессий деактивированного.
- Подписчик `directory.role.access_changed` (`events/role-access-changed.handler.ts`) — стоп-лист для `userIds` из payload: смена состава роли или её прав (#866, AUD-002).
- Подписчик `directory.user.updated` (`events/user-roles-changed.handler.ts`) — стоп-лист сотрудника, если `changedFields` содержит `roleIds` или `departmentId` (смена ролей/подразделения карточкой, #866, AUD-002); прочие правки профиля токены не трогают.

## Точка расширения (I13)

`AuthProvider` (токен `AUTH_PROVIDER`): `verifyCredentials(email, password) → AuthIdentity | null`.
Сейчас — `LocalAuthProvider`; Keycloak/LDAP в V2 подменяют реализацию без смены контрактов.

## Конфигурация (env)

`JWT_SECRET` (≥32, обязателен), `JWT_ACCESS_TTL_SECONDS` (900), `REFRESH_TOKEN_TTL_DAYS` (30), `COOKIE_SECURE` (по умолчанию = `NODE_ENV=production`).

## Лимиты

- Сессия: скользящие 30 дней; список сессий — без пагинации (десятки на пользователя).
- Нет TOTP 2FA и password-reset (V2, за `AuthProvider` и почтой).

## Документация (OpenAPI, I2)

Эндпоинты аннотированы для генерации спеки из кода (ADR-0006): схемы тела/ответов —
те же контракты (`loginSchema`, `authTokensSchema`, `sessionInfoSchema`, `authUserSchema`),
защита — `@ApiBearerAuth` на непубличных, ошибки — `@ApiErrors`, мутации — `@ApiIdempotencyKey`.
