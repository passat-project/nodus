# apps/api — @nodus/api

Backend портала: модульный монолит на NestJS 12 (адаптер Fastify), ESM.

## Запуск

- `pnpm dev` (в корне через turbo, или здесь) — `nest start --watch`, порт `API_PORT` (по умолчанию 3001), интерфейс — `API_HOST` (по умолчанию `0.0.0.0`: прежнее поведение и Docker; песочница live-stack сужает до `127.0.0.1`).
- `pnpm build && pnpm start` — прод-режим из `dist/`.

## Структура

- `src/main.ts` — bootstrap: Fastify-адаптер, глобальный префикс `/api/v1`, подключение OpenAPI.
- `src/core/` — сквозные механизмы (ошибки, EventBus, guards RBAC, аудит, openapi, `ports/` — read-порты кросс-модульного чтения, ADR-0012).
- `src/modules/<name>/` — доменные модули (controller/service/repository/dto/events, паттерн — `docs/architecture/patterns.md`): `auth`, `directory`, `dictionaries`, `notifications`, `files`, `home`, `desktop`, `workflows` («Процессы», ядро), `tasks` (флаг `tasks`), `chat` (флаг `chat`), `crm` (контрагенты, флаг `crm`).
- `src/infra/` — клиенты инфраструктуры (Prisma, Redis, MinIO, mail).
- `src/health/` — проверка живости `GET /api/v1/health` (используется Docker healthcheck).

## OpenAPI / документация (I2, ADR-0006)

Спецификация генерируется из кода (`@nestjs/swagger` + zod-схемы `@nodus/contracts`,
нативный Standard Schema) и публикуется на `/api/docs` (UI), `/api/docs-json`, `/api/docs-yaml` —
только для авторизованных (access-JWT в `Authorization: Bearer`). Подключение — `setupOpenApi`
(`src/core/openapi/openapi.setup.ts`) в `main.ts`; защита — `docs-auth.middleware.ts`
(маршруты документации регистрируются в обход гуардов). Паттерн аннотаций —
`docs/architecture/patterns.md`, раздел «OpenAPI-аннотации».

## Лимиты

- Cross-module импорты запрещены (I3, I6) — контролируется ESLint boundaries.
- Ответы наружу валидируются zod-схемами из `@nodus/contracts`.
