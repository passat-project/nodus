# Инструменты агента: скрипты репо и вход в сборки

Канон для двух типовых болей сессий (владелец, 06.11): агенты «правят скрипт под
задачу» (−20 минут) и «мучаются со входом» в dev-сборке (−10 минут), хотя
refresh-cookie делает повторный логин ненужным. Правило одно: **инструмент
вызывается, а не дорабатывается; вход — по рецепту, а не по наитию**.

## Железное правило: скрипты не правятся под задачу

- Скрипты `scripts/*.mjs` и npm-команды — общие инструменты, проверенные
  инцидентами. Правка «под задачу» (допилить флаг, сменить порт, обойти
  проверку, воткнуть свой сценарий в чужой скрипт) = баг, даже если работает:
  следующий агент получит изменённое поведение без документации.
- **Нет нужной команды/флага → STOP & ASK** владельцу или комментарий в issue с
  предложением (какой флаг, зачем, как безопасно). Свою одноразовую пробу пиши
  отдельным mjs-скриптом в `.live-stack/` (gitignored), а не правкой общего.
- **Правка скрипта законна только как отдельная задача**: нашёл баг самого
  скрипта → воспроизведение (вывод/лог) → отдельный коммит «fix(scripts): …» с
  объяснением в issue; у скриптов с тестами (`pnpm test:scripts`) — тест в том
  же коммите. Меняет поведение — обнови этот файл и навык в том же коммите (I12).
- Ошибка скрипта — это его ДАННЫЕ, а не повод рефакторить: каждый наш скрипт
  печатает диагноз и РЕЦЕПТ («Run first: pnpm live-stack down», «netstat -ano |
  findstr :4173 → taskkill /PID <pid> /F»). Читай сообщение целиком — 90%
  «поломок» лечится командой из самого сообщения.

## Карта «задача → команда»

| Задача | Команда |
|---|---|
| Поднять песочницу (цикл правок) | `pnpm live-stack up --dev` |
| Поднять песочницу (финальный показ перед вердиктом) | `pnpm live-stack up` (= `--preview`) |
| Песочница только для этого ПК (без LAN) | `pnpm live-stack up --dev --local` |
| UI-чекпоинт до бэкенда (исключение, ADR-0001) | `pnpm live-stack up --dev --mock <домены\|all>` |
| Состояние песочницы и dev-сервера владельца | `pnpm live-stack status` |
| Снять песочницу | `pnpm live-stack down` |
| Пересоздать БД/юзеров песочницы | `pnpm live-stack bootstrap` (или DROP `nodus_night` → `up`, см. live-stack.md) |
| Поднять dev-сервер владельца :5173 (если выключен и нужен) | `pnpm --filter @nodus/web dev` в фоне, затем проверить порт |
| Локальный e2e против песочницы | `E2E_LIVE_API=1 NODUS_BASE_URL=http://127.0.0.1:4173 pnpm --filter @nodus/e2e test specs/<spec>` |
| Выкатка/откат прода | **только по навыку `nodus-release`**: `node scripts/prod-deploy.mjs --version X.Y.Z` / `--current` (runbook `docs/runbooks/prod-update.md`) |
| Смок прода (после выкатки; сам не запускается) | `node scripts/prod-smoke.mjs` |
| Проверить техплан feature-architect | `pnpm plan:check <файл плана.md>` |
| Проверить инкубатор | `pnpm incubator:check` |
| Покрытие изменённых строк (CI; локально — после тестов) | `pnpm diff-coverage` |
| Гейты ветки | `pnpm lint && pnpm typecheck && pnpm test` |
| Юнит-тесты скриптов (после правки scripts/) | `pnpm test:scripts` |

Прод-контур (:3000/:3001/:3002, `nodus.by`) руками агента не трогается вовсе:
пробы запрещены, выкатка — только `prod-deploy.mjs` по навыку `nodus-release`
(команда владельца «ОБНОВИТЬ ПРОД» = разрешение). Смок после выкатки запускает
сам `prod-deploy.mjs`.

## Справочник скриптов (факты из кода)

### `pnpm live-stack <cmd>` — песочница (`scripts/live-stack.mjs`)

Синтаксис: `up [--dev] [--mock <домены|all>] [--local]` · `up [--preview]` ·
`down` · `status` · `bootstrap`. Порт `3011` (api health `/api/v1/health/ready`),
`3012` (gateway), `4173` (web). Web по умолчанию слушает `0.0.0.0` (LAN-адреса
печатают `up` и `status`), `--local` — loopback. Состояние — `.live-stack/pids.json` + `.live-stack/mode`;
логи `.live-stack/{api,gateway,web}.log`. `up`: проверка живых PID и портов →
авто-изоляция `DATABASE_URL`→`nodus_night`, `REDIS_URL`→db1 → бутстрап (БД →
миграции → сид → night-пользователи) → свои секреты подписи
(`.live-stack/secrets.json`) → сборка → старт детачнутых процессов → health-гейты.
Стартует эфемерный `gotenberg-sandbox` (docker profile sandbox), `down` его гасит.
Типовые отказы (по коду скрипта, все — громкие, с рецептом):

| Сообщение | Механизм | Что делать |
|---|---|---|
| `live-stack already running … Run first: pnpm live-stack down` | живые PID из pids.json | сначала `down`, потом `up` (не taskkill) |
| `Port :4173 is taken by a FOREIGN process` | порт занят процессом не из pids.json (сирота прошлой сессии) | рецепт из ошибки: `netstat -ano \| findstr :4173` → `taskkill /PID <pid> /F` |
| `DATABASE_URL указывает на прод-базу 'nodus'` | явный env указывает на прод | снять экспортированный env; прод-прогон (`SANDBOX_ON_PROD=1`) — не для проб |
| `секрет песочницы JWT_SECRET совпадает с .env (прод)` | в env протёк прод-секрет | убрать из env процесса |
| `моки работают только в vite dev` | `--mock` без `--dev` | `up --dev --mock <домены>` |
| `did not become healthy … see .live-stack/<name>.log` | сервис упал на старте | хвост лога из сообщения; частые причины — docker/БД (`docker ps`, `bootstrap`) |

### `node scripts/prod-deploy.mjs` — выкатка/откат прода (ADR-0036)

`--version X.Y.Z [--prod-dir D:/NodusProd] [--dry-run]` · `--current` (поднять
текущую версию после перезагрузки хоста). Kit и смок берутся ИЗ ТЕГА (рабочее
дерево не источник), образы сверяются с коммитом тега и пинятся digest'ами,
каждая выкатка — строка в `deployments.log`. Провал печатает команду отката, но
сам не откатывает — решение за оператором. Запуск агентом — только внутри
навыка `nodus-release`. `--dry-run` безопасен (только `compose config --quiet`).

### `node scripts/prod-smoke.mjs` — смок прода

`[--base https://nodus.by] [--api http://localhost:3001 | --no-api]
[--desktop-version X.Y.Z] [--allow-no-desktop]`. Проверяет главную, health api,
раздачу оболочки (`/desktop/latest.json` + установщик > 1 МБ). Любой красный —
код 1. Список проверок и флаги — в шапке скрипта.

### `pnpm plan:check <план.md>` — механическая проверка техплана

Разделы шаблона/«не применимо», источник у каждого решения, существование и
допустимая длина file:line ссылок (файлы, которые план создаёт, — помечай
«(новый)»), доказательства у критериев приёмки, лимит 65 536 знаков. FAIL — код 1;
«конвейер пройден» без зелёного вывода не пишется.

### `pnpm incubator:check` — целостность инкубатора

Индекс + карточки + архив, следующий свободный ID. Блокеры — код 1, предупреждения — 0.

### `pnpm diff-coverage` — покрытие изменённых строк

`--base` (по умолчанию `origin/main`), `--threshold` (80). Код 1 ниже порога.
Требует свежего отчёта coverage (`pnpm test:coverage`).

### Остальное (обычно CI, руками — по навыку)

`scripts/desktop-manifest.mjs` (latest.json апдейтера оболочки; вызывается после
`tauri build` в CI), `scripts/desktop-publish.mjs` (единственный способ выложить
выпуск оболочки: `--run <id>`|`--from <dir>` + `--dest` + `--dry-run`; ручное
копирование запрещено), `scripts/coverage-summary.mjs` (сводка, не гейт),
`scripts/night-users.mjs` (night-a/b; работает ТОЛЬКО против `nodus_night`,
другая база — отказ). Полный синтаксис — в шапке каждого скрипта (это наш
`--help`: читай первые 20 строк файла).

## Вход в :4173 (песочница, non-mock) — refresh-cookie работает за тебя

Механика (по коду): вход `POST /auth/login` выдаёт access-токен на **15 минут**
(живёт только в памяти SPA) и refresh-сессию на **30 дней со скользящей
ротацией** в httpOnly-cookie `nodus_refresh` (`path=/api/v1/auth`, SameSite=Lax;
`apps/api/src/modules/auth/auth.config.ts`). При каждом открытии страницы
`bootstrap()` сам дергает `/auth/refresh` по cookie → `/auth/me` → ты сразу на
рабочем экране. **Повторный логин не нужен, пока cookie жива** — это и есть
ответ на «10 минут со входом»: не логинься, просто открой страницу.

Рецепт «открыть → войти → работать» (Playwright):

1. `pnpm live-stack status` — стек поднят? Нет → `pnpm live-stack up --dev`.
2. Открыть `http://127.0.0.1:4173/`. Не редиректнуло на `/login` → сессия жива,
   работать сразу (перезагрузка/переоткрытие в том же контексте её не убивают).
3. Выбросило на `/login` → один UI-логин: `getByLabel('Рабочая почта')` +
   `getByLabel('Пароль')` → кнопка «Войти» → `waitForURL(/home/)`. Креды —
   `tests/e2e/e2e-users.json`: `night-a@nodus.local`/`night-b@nodus.local` (обе
   роль «Администратор», для двухпользовательских сценариев) или сидовые
   `admin@nodus.by` / `a.klimovich@passatproekt.by`. Пароли — там же; в TS —
   `import { NIGHT_A } from '../e2e-users.js'`.
4. Навигация по SPA — `history.pushState` + `popstate` (TanStack Router), не
   `page.goto` на каждый маршрут. Reload сессию НЕ убивает (в отличие от мокового
   :5173), но зачем он тебе.
5. Скрипту без браузера — REST: `POST /api/v1/auth/login {email,password}` →
   `accessToken` → `authorization: Bearer …`. POST-мутации — с уникальным за
   ПРОГОН `Idempotency-Key`. Токен SPA живёт в памяти стора — в открытую страницу
   его не подсунуть, а из node-fetch можно всё.

Сессия реально мертва только при 401 (`AUTH_SESSION_INVALID`) — тогда п.3.
Сеть отвалилась/5xx — это НЕ мёртвая сессия, страница сама дожмёт refresh.
Каждый новый browser-контекст = своя cookie-база: держи контекст на сценарий.

## Вход в :5173 (dev-сервер владельца, моки)

Контур владельца: поднят — не трогать; выключен, а нужен (моки, чекпоинт) —
`pnpm --filter @nodus/web dev` в фоне (это тот же контур, не второй сервер).
Прежде чем звать владельца «смотри на :5173» — `pnpm live-stack status`
(строка `dev-owner`); вниз, а чекпоинт на моках нужен — поднять (см. выше).
Приёмка на живых данных (готовый бэкенд) — на `:4173` песочницы.

Состав моков задаёт `VITE_API_MOCK` в корневом `.env`: список доменов (у
владельца `tasks,letters,…`; chat — живой) | `true` (все) | `false` (всё живое).
Прокси: `/api` → `NODUS_API_DEV_TARGET` из `.env` (сейчас — api песочницы
`:3011`), `/socket.io` → gateway песочницы.

- **auth НЕ в списке моков** (текущий `.env`): вход ЖИВОЙ — те же учётки, что и
  на :4173, refresh-cookie работает одинаково; моки отвечают только в
  перечисленных доменах.
- **auth замокан** (`VITE_API_MOCK=true` или `auth` в списке, песочница
  `up --dev --mock all`): вход ЛЮБЫМИ данными (валидна только форма e-mail+пароль);
  e-mail `user1…user10@passatproekt.by` выбирает демо-актёра с его правами —
  способ проверить поведение разных ролей без бэкенда. MSW ставит cookie-метку
  `nodus_refresh=alive`; «Выйти» помечает её `dead`. Состояние мок-сессии — в
  памяти страницы: reload возвращает демо-администратора, поэтому навигация в
  пробах — только pushState, без reload и `goto` между маршрутами.

Скриншоты каркаса на моках — готовый скрипт `node tests/e2e/shots.mjs [outDir]`
(`NODUS_BASE_URL=http://localhost:5173`), сам логинится демо-кредами.

## Почему канон такой (Exa-сверка, 06.11)

- **«Не изобретай: есть хелпер — вызывай его»** — прямой аналог нашего
  железного правила (community-scripts DevScripts AGENTS.md: «Do not invent. If
  a helper exists, call it» — агенты, дописывавшие свои обёртки поверх хелперов,
  стали причиной самого правила): https://github.com/community-scripts/DevScripts/blob/main/AGENTS.md
- **Документируй свои инструменты с примерами там, где агент их прочтёт**
  (Anthropic, Claude Code Best Practices — про кастомные bash-инструменты в
  CLAUDE.md/AGENTS.md; наш аналог — этот навык): https://www.anthropic.com/research/claude-code-best-practices
- **Инструмент = контракт: ясная цель, однозначные имена, описания как для
  нового сотрудника, ошибки несут следующий шаг** (Anthropic, Writing effective
  tools for AI agents): https://www.anthropic.com/engineering/writing-tools-for-agents
- **Ошибки, которые учат (remediation), подтверждение мутаций, exit-коды по
  режимам отказа** (Arcjet, Designing a CLI for AI agents): https://blog.arcjet.com/designing-a-cli-for-ai-agents/
- **`--json`/стабильный вывод, «команда, сделавшая ничего, не выходит 0»,
  «расскажи агенту, как тобой пользоваться: skill/AGENTS.md»** (Devpit, Making a
  CLI that AI agents can use safely; канон clig.dev): https://devpit.zubyr.dev/docs/blog/making-a-cli-ai-agents-can-use-safely · https://clig.dev
- **Help — первый запрос агента, примеры копируются, вывод — контракт
  stdout/stderr** (Jed Arden, Your CLI has a second user now): https://jedarden.com/notes/cli-design-for-humans-and-agents/
- **Примеры вызовов в инструкциях сильнее описаний** (OpenAI GPT-4.1 prompting
  guide — примеры в `# Examples` секции промпта): https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide

Выводы, применённые здесь: таблица «задача → команда» с точными примерами
вызова; правило «вызывай, не правь» с явной процедурой эскалации; рецепты входа
по шагам вместо описания механики; сообщения об ошибках наших скриптов уже
следуют паттерну «диагноз + рецепт» — читай их, прежде чем что-то менять.
