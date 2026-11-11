# Модуль preferences (ядро)

Личные настройки интерфейса сотрудника (#745, эпик #744).

## Назначение

Хранит и отдаёт персональный `UiPreferences` (`packages/contracts/src/views/ui-preferences.schemas.ts`):
порядок/скрытые модули навигации и раскладку карточек `cardTabs` (области вкладок, ширины, скрытые вкладки,
открытая панель беседы). Настройки — на сотрудника, переносятся между компьютерами; localStorage у клиента —
мгновенный кэш того же формата.

## API

| Метод | Путь                     | Назначение                                                       |
| ----- | ------------------------ | ---------------------------------------------------------------- |
| GET   | `/api/v1/me/preferences` | `{ preferences, updatedAt }` текущего сотрудника                 |
| PUT   | `/api/v1/me/preferences` | Полная замена `{ preferences, baseUpdatedAt? }`, last-write-wins |

- `userId` берётся **только** из access-токена (`@GetUser`); в теле/query его нет — чужой профиль недоступен (I8, IDOR).
- PUT идемпотентен по природе (замена), `@ApiIdempotencyKey`; доменных событий и outbox нет — это не изменение сущности.
- Размер тела ограничен 32 КБ (`CARD_TABS_MAX_BYTES`), лишние/неизвестные поля отбрасываются zod-схемой.
- Битые данные в БД не роняют портал: чтение валидирует JSONB и отдаёт дефолт при ошибке.

## Данные

`user_preferences` (`apps/api/prisma/schema.prisma`, модель `UserPreference`): `user_id` — PK (plain UUID без FK, I3),
`data` — JSONB с `UiPreferences`, `updated_at` — Timestamptz. Одна строка на пользователя.

## Границы

- UI движка вкладок и DnD — web-фича `shared/ui/entity-card` (#746).
- Админские company-wide дефолты раскладки — отдельное решение (скоуп `company` для nav уже есть).
- Реалтайм-синхронизация между устройствами не требуется: GET при входе + debounce PUT.
- Клиент (`shared/preferences/ui-prefs-sync.ts`) держит маркер `nodus-ui-prefs-dirty:<userId>`: пока есть
  неотправленные локальные правки, серверный GET не применяется, а локальное досылается PUT (last-write-wins
  без потери правок при reload/офлайне).
