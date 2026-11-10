# Runbook: создание GitHub-репозитория и базовый коммит

> **Статус: выполнен (01.09.2026).** Репозиторий `github.com/Alexandrisius/nodus` создан и настроен по шагам 1–5 этой процедуры. Документ оставлен как протокол и ради раздела «Открытые вопросы» внизу; повторное выполнение шагов 1–5 не требуется. Шаги 6–9 выполняются после скелета монорепо (issue #1).

Одноразовая процедура. Выполняется по явной команде владельца (меняет настройки GitHub и Cloudflare).

## Цель

Приватный репозиторий `Alexandrisius/nodus` с настроенными labels, milestone и первыми issues — готовый к работе по `docs/process/workflow.md`.

## Предусловия

- `gh` CLI установлен и авторизован (`gh auth status` — аккаунт Alexandrisius).
- Git установлен; локальная папка проекта — `d:\Project\AI\nodus`.

## Шаги

### 1. Первый коммит

```bash
git init
git add -A
git commit -m "chore: фундамент проекта — документация, процессы, навыки (#1)"
```

### 2. Репозиторий

```bash
gh repo create Alexandrisius/nodus --private --source=. --push
```

### 3. Labels (по `docs/process/workflow.md`)

```bash
gh label create "type:feature" --color 0E8A16
gh label create "type:bug" --color D73A4A
gh label create "type:chore" --color 6B7280
gh label create "type:epic" --color 8B5CF6 --description "Эпик: бизнес-кейс из roadmap, контейнер дочерних issues"
gh label create "P0" --color B60205
gh label create "P1" --color D93F0B
gh label create "P2" --color FBCA04
gh label create "area:web" --color 1D76DB
gh label create "area:api" --color 5319E7
gh label create "area:infra" --color 0052CC
gh label create "area:docs" --color 0075CA
gh label create "module:chat" --color C5DEF5 --description "Мессенджер: беседы, каналы, треды, реакции, стикеры (M6)"
gh label create "module:tasks" --color C5DEF5 --description "Задачи: статус-схемы, канбан, трекинг времени (M4)"
gh label create "module:projects" --color C5DEF5 --description "Проекты: журнал, карточка, проектный канбан (M4)"
gh label create "module:correspondence" --color C5DEF5 --description "Корреспонденция: письма, регистрация, резолюция → поручение (M5)"
gh label create "module:files" --color C5DEF5 --description "Файлы: хранилище SILO, просмотр, производные (M9)"
gh label create "module:workflows" --color C5DEF5 --description "Согласования и workflow-схемы (M7)"
gh label create "module:auth" --color C5DEF5 --description "Доступ: логин, сессии, учётки сотрудников (M2)"
gh label create "module:directory" --color C5DEF5 --description "Справочник сотрудников и оргструктура (M2)"
gh label create "module:notifications" --color C5DEF5 --description "Уведомления: центр, правила, каналы доставки (M8)"
gh label create "module:dictionaries" --color C5DEF5 --description "Справочники/классификаторы бизнес-списков (ядро, I15)"
gh label create "module:core" --color C5DEF5 --description "Кросс-модульная платформа: дизайн-система, общие механизмы, ui-preferences, зависимости"
gh label create "status:ready" --color 3FB950 --description "Спека готова или не требуется — можно брать (порядок по roadmap/P)"
gh label create "status:draft" --color CCCCCC --description "Драфт/задел — ждать решения владельца, в работу не брать"
gh label create "status:waiting-trigger" --color D4C5F9 --description "Задел с триггером — брать только при наступлении триггера из тела issue"
```

Полный канон измерений — `docs/process/workflow.md` (раздел «Метаданные issues»); живой словарь значений — `gh label list`.

### 4. Milestone

```bash
gh api repos/Alexandrisius/nodus/milestones -f title="MVP" -f description="Концепт для согласования и пилота (docs/product/vision.md)"
```

### 5. Первые issues (заготовки; планы по фазам — при взятии в работу)

1. **«Скелет монорепо и инфраструктура качества»** (`type:chore`, `area:infra`, P0). Скоуп: pnpm-workspace + turbo + базовые tsconfig; ESLint (boundaries + лимит размера файлов по I5) + Prettier; Husky + lint-staged; `engines`/`packageManager` (Node 24, pnpm); `dependabot.yml` (шаблон — правило `security-dependency-audit` навыка `nestjs-best-practices`); CI lint → typecheck → test → build; `docker-compose.yml` (префикс `nodus_`, порты через `.env`, dev-профиль по ADR-0002: web/api/gateway/postgres/redis/minio/gotenberg + cloudflared); `.env.example`. Вне скоупа: core-механизмы и модули (отдельные issues). PR №1 — единственный, который мержится без CI (CI он и добавляет).
2. **«Core: сквозные механизмы»** (`type:feature`, `area:api`, P0). Скоуп: канон `docs/architecture/patterns.md` раздел «Core-примитивы» — DomainException + глобальный фильтр ошибок, ErrorCode/ApiErrorResponse в contracts, TransactionRunner, EventBus + outbox (таблица `events`), ZodValidationPipe, nestjs-pino, аудит- и идемпотентность-интерсепторы, RBAC-гуарды (`@GetUser`, `@RequirePermissions`, PermissionGuard), feature flags, health-checks. **Обязательная сверка:** имена в реализованном коде = имена в навыках `.agents/skills/` (иначе навыки устарели = баг, I12).
3. **«Auth + directory»** (`type:feature`, `area:api`, P0). Логин (argon2id, JWT access/refresh с ротацией), сессии, пользователи/отделы/роли (directory), сидинг по ADR-0002.
4. **«Дизайн-система и каркас UI»** (`type:feature`, `area:web`, P1). `packages/ui` (shadcn/ui, токены, темы), каркас по `docs/product/ux-principles.md` (меню/топбар/слайдеры), TanStack Router, MSW-инфраструктура (ADR-0001), i18n (`packages/contracts/i18n/ru.ts`).

### 6. Настройки ветвления и branch protection на `main`

Выполняется **после** скелета (issue #1), когда CI (`.github/workflows/ci.yml`) отработал на `main` хотя бы раз (нужно имя проверки). С этого момента прямые коммиты в `main` закрыты — работа возвращается к PR-флоу (`docs/process/workflow.md`).

> **Ограничение тарифа GitHub Free:** для приватных репозиториев branch protection недоступен — API отвечает `403 Upgrade to GitHub Pro or make this repository public to enable this feature`. Варианты: (а) GitHub Pro; (б) публичный репозиторий (бизнес-решение владельца — код корпоративного портала); (в) отложить: команды ниже сохранены здесь и применяются при первой возможности, до этого `main` защищается только дисциплиной workflow. Решение — за владельцем.

Настройки ветвления (squash-only) работают и на Free — применить в любом случае:

```bash
gh api -X PATCH repos/Alexandrisius/nodus \
  -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F allow_squash_merge=true -F delete_branch_on_merge=true
```

Защита `main`: require PR + require status checks (CI):

```bash
gh api -X PUT repos/Alexandrisius/nodus/branches/main/protection \
  -F "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=lint → typecheck → test → build" \
  -F "required_pull_request_reviews[required_approving_review_count]=0" \
  -F "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -F enforce_admins=false \
  -F restrictions=null \
  -F required_linear_history=true \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

Проверка: `gh api repos/Alexandrisius/nodus/branches/main/protection --jq '.required_status_checks.contexts'`.

### 7. Dependabot

- Конфиг в репозитории (`.github/dependabot.yml`) — PR-ы приходят еженедельно по понедельникам, группами.
- Включить алерты уязвимостей: GitHub → Settings → Code security → **Dependabot alerts** и **Dependabot security updates** — ON.

### 8. Cloudflare Tunnel к `nodus.by` (dev/демо, ADR-0002)

1. Cloudflare Zero Trust → Networks → Tunnels → **Create tunnel** → Cloudflared.
2. Токен туннеля — в `.env` хоста: `NODUS_TUNNEL_TOKEN=...`.
3. Public hostname: `nodus.by` → service `http://nodus_web:80` (HTTP). Одного хостнейма достаточно: `/api` и `/socket.io` проксируются nginx внутри web-контейнера.
4. Поднять: `docker compose --profile tunnel up -d`. Проверка: `https://nodus.by/api/v1/health`.

Туннель — только для dev/демо. Прод (пилот, LAN компании) — Caddy по отдельному runbook (к пилоту).

### 9. Локальное окружение разработчика

- Node 24 (≥ **24.15** — требование schematics NestJS 12 для `nest generate`/`upgrade`; пин мажорки — `.node-version`), pnpm 11 (`npm i -g pnpm@11`; corepack необязателен).
- `cp .env.example .env` и заполнить пароли — требуется для `docker compose up`.
- Pre-commit хук ставится сам при `pnpm install` (Husky). Скрипты и хуки — всегда LF (см. Gotchas в AGENTS.md).
- **Windows: права на каталог проекта** (#337). Каталог на диске `D:\` по умолчанию наследует `Прошедшие проверку:(M)` и `Пользователи:(RX)`: любая локальная учётка читает `.env` с прод-секретами и может подменить JS/бинарники в `node_modules` (выполнятся при следующем `pnpm`). Сразу после клонирования, в PowerShell от своей учётки:

  ```powershell
  $p = 'D:\Project\AI\nodus'   # путь клона
  icacls $p /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /Q
  icacls $p /inheritance:r /Q   # дочерние наследуют новый DACL автоматически
  icacls $p\.env               # ожидаемо: Администраторы, СИСТЕМА, вы — и никого больше
  icacls $p /findsid *S-1-5-11 /T /C /Q   # «Прошедшие проверку» во всём дереве: ожидаемо «не найдено»
  ```

  **Каждый новый worktree** (`git worktree add ../nodus-…`, параллельные сессии — gotchas) — те же команды с `$p` = путь worktree сразу после создания, ДО `pnpm install` и копирования `.env`: соседние каталоги наследуют слабые права от `D:\Project\AI`.

  Откат — `icacls $p /reset /T`. Docker Desktop (bind-mount `infra/desktop-dist`) и git работают от вашей учётки — не задеваются (проверено 19.10). Права профиля важны и без пина: SWC ≥ 1.16 проверяет кэш в профиле (`%LOCALAPPDATA%\swc`), а не в проекте; пин 1.15.47 снят 10.11.2026 (#362) — после изменения прав профиля проверяй `node -e "require('@swc/core')"`.

## Проверка результата

- `gh repo view Alexandrisius/nodus` открывается; приватность — Private.
- `gh label list` — 25 labels; `gh issue list` — 4 issues с milestone MVP.
- `git log --oneline` — коммиты на `main`; `git status` — чисто.

## Откат

Репозиторий создан ошибочно → `gh repo delete Alexandrisius/nodus --yes` (коммит локальный остаётся, повторить с шага 2).

## Открытые вопросы для первых issues (закрыть при взятии в работу, не блокируют коммит)

- Нумерация задач: глобальная или per-project последовательность, формат номера (бизнес-вопрос владельца).
- Начальная стадия новой задачи и канонический набор стадий дефолтной WorkflowScheme (seed) — бизнес-вопрос.
- Механика идемпотентности: хранение `Idempotency-Key` (таблица/Redis, TTL, scope) — спроектировать в issue «Core», при нетривиальности — ADR.
- Канонический каталог `Permission` (начальный набор) — в issue «Auth + directory».
- Админка статус-схем (WorkflowScheme): владелец редактора — модуль `admin` или `tasks` — уточнить в карте модулей при реализации.
- Виртуализация длинных списков (TanStack Virtual?) — решение при первом тяжёлом списке, зависимость = ADR.
- Связь Task→Letter без cross-module доступа (обработчик `correspondence.resolution_issued`) — спроектировать в issue модуля correspondence.
