# apps/web — @nodus/web

Фронтенд портала: React 19 SPA на Vite (без Next.js — портал за логином, SEO не нужен).

## Запуск

- `pnpm dev` — Vite dev-сервер, порт `NODUS_WEB_DEV_PORT` (по умолчанию 5173). `/api` и `/socket.io` проксируются на локальные api/gateway (см. `vite.config.ts`).
- `pnpm build` — статическая сборка в `dist/` (в docker раздаётся nginx, см. `infra/nginx/web.conf`).
- `VITE_API_MOCK=true` в корневом `.env` — MSW-режим (ADR-0001): фронт целиком на моках без бэкенда (концепт, демо руководству). Воркер — `public/mockServiceWorker.js` (`msw init public`), хендлеры фич — в `features/*/api/mocks/` (тела мутаций валидируются zod-схемами contracts), демо-данные — в `src/shared/mocks/data/`, агрегат — `src/app/mocks-handlers.ts` (композиционный слой).

## Структура (по `docs/architecture/repository-structure.md`)

- `src/app/` — роутер (TanStack Router, code-splitting по модулям, системные экраны 404/ошибки — `shell/system-screens.tsx`), каркас `shell/`: левая рейка-магистраль 240px (персональный порядок со «Скрытое», ui-prefs), топбар (фиксированные вкладки модулей из `nav-registry.ts`, Ctrl+K, профиль), служебная полоса справа 40⇄216px, стек карточек-слайдеров (ADR-0009, `?cards=`), контур-схема (circuit-*).
- `src/features/<module>/` — фичи, зеркало backend-модулей (`api/`, `components/`, `pages/`, `lib/`, README; `model/` — по необходимости, patterns.md).
- `src/shared/` — переиспользуемое: `api-client.ts` (единственный fetch, Idempotency-Key, refresh-контур), `auth-store.ts`, `views/` (машина представлений: DataTable + useViewFields + пресеты + сортировка + drag колонок), `ui/board/` (канбан-движок `use-kanban-board`), `chat/` (чат-машина, 4 потребителя), `lib/`, `ui/` (PersonCell, PersonAvatar, чипы), `mocks/data/`.

## Направление слоёв (eslint-boundaries, аудит #45)

`app` (композиция) → `features` → `shared`. Запрещены линтером: cross-feature, `shared → features`, `shared → app`. `features → app` — только публичное API каркаса (`use-card-stack`, `slider-panel`, `circuit-geometry`, `nav-registry`, `logo-icon`). Shared открывает карточки через мост `shared/lib/card-bridge.ts` (порт-адаптер).

## Тема «Инструмент»

Всё визуальное — дизайн-токенами `@nodus/ui` (тема как данные): `:root` — СВЕТЛАЯ (дефолт, вердикт владельца 15.09.2026), `[data-theme='dark']` — тёмная; переключатель в топбаре; anti-FOUC — inline-скрипт в `index.html` ставит `data-theme` до первой отрисовки (persist `nodus-shell-v1`). Компоненты не содержат значений токенов. Канон UI — навык `nodus-ui-style` (токены, примитивы, контур, таблицы, персональный порядок).

## Живая галерея дизайн-системы (`/dev/ui`)

`/dev/ui` — живая галерея дизайн-системы: все примитивы `@nodus/ui` и `src/shared/ui` во всех состояниях, токены и типографика обеих тем на одной странице (приёмка канона и валидация токенов). Экран включается **только в dev-режиме Vite или флагом сборки `VITE_SANDBOX_DEV_UI=1`**, который выставляет исключительно `scripts/live-stack.mjs` (preview-песочница `:4173` — там страницу смотрит владелец). В прод-бандл она не попадает: `vite.config.ts` подставляет флаг статичным `'0'`, выражение в `src/app/router.tsx` сворачивается, маршрут и lazy-чанк страницы вырезаются (проверка — grep по `dist/` на `dev-ui|DevUiPage|Дизайн-система`).

## Лимиты

- UI-примитивы — только из `@nodus/ui`, локальные копии запрещены.
- Данные — только через хуки `features/*/api/` (TanStack Query), `fetch` в компонентах запрещён; query keys — только через factory.
- UI-строки — из i18n (`@nodus/contracts`): рабочий интерфейс — из общего словаря `ui`, dev-галерея — из отдельного экспорта `devUiStrings` (`i18n/ru-dev-ui.ts`), не входящего в `ui`. Разделение осознанное: словарь `ui` уезжает в прод-бандл целиком, а строки галереи обязаны исчезнуть вместе с её маршрутом (иначе в `dist/` остаётся текст экрана, которого нет). Хардкод строк в компонентах запрещён (I15) — и для dev-экрана тоже. Терминология — русская деловая.
- Cross-feature импорты запрещены (ESLint boundaries): общее — `@nodus/contracts`, `@nodus/ui`, `src/shared`.
- Persist-сторы (zustand `nodus-*-v1`) — с zod-валидацией rehydrate (`shared/lib/persist-zod.ts`) и `version`; битая форма сохранённого — молчаливый дефолт (I7). Известное ограничение: вкладки одного браузера не синхронизируются.
- Eager-импорт `CardStackHost` в главном чанке — осознанный (вердикт владельца: карточки открываются с первого кадра); page-чанки модулей — ленивые.
