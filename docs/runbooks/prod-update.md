# Runbook: обновление прода (docker-контур nodus.by)

**Цель:** выкатить выпуск `vX.Y.Z` на прод-контур этого хоста (контейнеры
`nodus_*`, `:3000/:3001/:3002`, туннель `nodus.by`) так, чтобы пользователи
получили новую версию и окно «Что нового».

Полный цикл выпуска (сбор изменений, тексты, релизный PR, тег, GitHub
Release) — навык `nodus-release`; этот runbook — шаги выкатки, смок и откат.
Устройство прода — ADR-0036: на хосте ничего не собирается, версия берётся из
готовых образов, а «что сейчас на проде» определяется `.env` прод-каталога, а
не каталогом, из которого запустили compose.

**Предусловия:**

- выпуск смержен в `main`, тег `vX.Y.Z` создан и запушен;
- workflow `images` по этому тегу зелёный (три образа в GHCR):
  `gh run list --workflow=images.yml --limit 3`;
- прод-каталог `D:\NodusProd` существует: `.env` (единственный боевой),
  `desktop/`, `backup/`, `kit/`, `deployments.log`; исходников и `.git` там нет;
- в `.env` заданы `NODUS_DESKTOP_DIR` **абсолютным** путём вне git-деревьев
  (`D:/NodusProd/desktop`; относительный резолвится от каталога compose-проекта
  и молча гасит кнопку «Скачать приложение» — инцидент 02.11, #560),
  `COMPOSE_PROFILES=office,tunnel` и `NODUS_WEB_MOCK=false`;
- `D:\NodusProd` — прод-данные, не остатки сессий: не удалять и не чистить.

## Шаги

1. Проверить, есть ли в выпуске миграции — сравнить каталоги с прошлым тегом:
   ```bash
   git fetch --tags origin
   prev=$(git describe --tags --abbrev=0 --match 'v*' vX.Y.Z^)
   git diff --name-only "$prev..vX.Y.Z" -- apps/api/prisma/migrations/
   ```
   Пусто — миграций в выпуске нет. Не пусто — **сначала бэкап БД** (файл
   вне репо):
   ```bash
   docker exec nodus_postgres pg_dump -U <pguser> nodus | gzip > D:/NodusProd/backup/pre-$(date +%Y%m%d-%H%M).sql.gz
   ```
   «No pending migrations» в логе — не доказательство: применённость
   верифицируется по `_prisma_migrations` (список = локальные миграции
   `apps/api/prisma/migrations/`).
2. Проверить выкатку без изменений на хосте:
   ```bash
   node scripts/prod-deploy.mjs --version X.Y.Z --dry-run
   ```
   Скрипт проверяет `.env`, достаёт kit версии из тега и прогоняет
   `docker compose config --quiet`; `.env`, образы и контейнеры не трогаются.
3. Выкатить:
   ```bash
   node scripts/prod-deploy.mjs --version X.Y.Z
   ```
   Что происходит: kit `D:\NodusProd\kit\vX.Y.Z` собирается из тега
   (`git show`, рабочее дерево не трогается) → `NODUS_VERSION` пишется в
   `.env` → `config --quiet` → `pull web api gateway` → проверка привязки
   образов к коммиту тега → `up -d` → ожидание `healthy` (до 180 с) →
   обязательный смок → строка в `deployments.log` с digest. Сборки на хосте
   нет. Тег на `origin` не должен быть перемещён, а label
   `org.opencontainers.image.revision` вытянутых образов — совпадать с
   коммитом тега: kit и образы обязаны быть одной поставкой. Повторная
   выкатка версии сверяется ещё и с digest первой выкатки
   (`kit/vX.Y.Z/digests.json`).
4. Дождаться итога смока в выводе. Красный смок = выкатка не принята, скрипт
   печатает команду отката.
5. Бэкфилл поисковой проекции (#952) — один раз после выкатки выпуска с
   поиском (идемпотентно, повторный прогон строк не меняет):
   ```bash
   docker compose -p nodus exec api node dist/modules/search/cli/reindex.js
   docker exec nodus_postgres psql -U nodus -d nodus -c "SELECT count(*) FROM search_documents"
   ```
   Второй счётчик должен быть > 0; окно поиска на проде отдаёт строки
   (проверка владельцем живым взглядом: Ctrl+K).

**Первый переход с локальной сборки** (один раз на хост): `up -d` пересоздаёт
только сервисы с изменившимся конфигом, поэтому инфраструктурные контейнеры
(postgres, redis, minio, documentserver, cloudflared) могут остаться с меткой
старого каталога. После успешного `prod-deploy` пересоздать их из прод-каталога
тем же kit'ом, чтобы весь прод жил из одного места:

```bash
docker compose -p nodus --project-directory D:/NodusProd --env-file D:/NodusProd/.env \
  -f D:/NodusProd/kit/vX.Y.Z/docker-compose.yml -f D:/NodusProd/kit/vX.Y.Z/compose.prod.yaml \
  --profile office --profile tunnel up -d --force-recreate postgres redis minio minio-init documentserver cloudflared
```

Проверка: у всех `nodus_*`, кроме `nodus_gotenberg_sandbox` (артефакт dev-дерева),
`com.docker.compose.project.working_dir` = `D:\NodusProd`. Данные в томах не
теряются; простой — секунды-минута.

Миграции БД применяет api при старте (`prisma migrate deploy` в CMD образа) —
отдельной команды нет.

## Смок (только чтение — создавать данные и гонять пробы на проде запрещено)

`prod-deploy.mjs` запускает смок сам; вручную (например, после перезагрузки):

```bash
node scripts/prod-smoke.mjs                           # главная, api, манифест оболочки, установщик
curl -fsS http://localhost:3001/api/v1/health          # api жив, JSON 200
docker exec nodus_web sh -c "grep -l 'releases/X.Y.Z.json' /usr/share/nginx/html/assets/*.js" \
  | head -1                                             # бандл несёт новый выпуск
docker logs --since 5m nodus_api 2>&1 | grep -iE "error|migrat" | tail -20
```

`prod-smoke.mjs` проверяет то, чего старый чеклист не видел: `/desktop/latest.json`
отдаётся, URL установщика абсолютный, файл скачивается. Сверка версии оболочки
(`--desktop-version`) — отдельная операция при выпуске самой оболочки (runbook
`desktop-deploy.md`): версия оболочки 1.0.x и версия портала vX.Y.Z — разные
шкалы. Портал без раздачи оболочки — флаг `--allow-no-desktop`.

Последняя команда — только у выпусков с текстами «Что нового» (технический
выпуск JSON не добавляет).

## Откат

Выпуск сломал прод (контейнер не healthy, смок красный):

1. `node scripts/prod-deploy.mjs --version <предыдущая>` — переключение на
   прошлые образы без пересборки (предыдущая версия — в `deployments.log`).
2. **Миграции назад не откатываются** (только вперёд, навык
   `prisma-migrations`): expand-миграции (новые таблицы/колонки) старому коду
   не мешают; если выпуск содержал contract-изменение (drop/rename) — откат
   кода невозможен без восстановления БД, STOP & ASK владельца.
3. Особый случай — первый переход с локальной сборки: прежних образов в GHCR
   нет. Тогда старый путь: `cd ../nodus-rel`, `git switch --detach <прежний
   тег>`, `docker compose --profile tunnel --profile office up -d --no-build`
   (локальные образы прежней версии ещё на месте). Доложить владельцу.
4. Доклад владельцу + issue `type:bug` с механизмом; тег сломанного выпуска не
   удаляется (история), исправление выходит следующим патчем.

## Прерванная миграция (api не стартует, P3009)

Симптом: после выкатки `nodus_api` не выходит в `healthy` и рестартит; в логе
`Error: P3009` — «migrate found failed migrations in the target database, new
migrations will not be applied». Контейнер убит (kill/OOM/перезагрузка)
посреди `prisma migrate deploy`, и в `_prisma_migrations` осталась строка без
`finished_at`. Остальной портал жив, api — нет; дальнейшие миграции не
применяются.

1. Диагностика — какая миграция прервана и что она успела применить:
   ```bash
   docker logs --tail 200 nodus_api 2>&1 | grep -E "P3009|migration"
   docker exec nodus_postgres psql -U <pguser> -d <db> -c \
     "SELECT migration_name, started_at, finished_at, rolled_back_at FROM \"_prisma_migrations\" ORDER BY started_at DESC LIMIT 5;"
   ```
   Прерванная — запись с пустыми `finished_at` и `rolled_back_at`. Её SQL —
   `apps/api/prisma/migrations/<migration_name>/migration.sql`; сверьте с
   фактической схемой (`\d <таблица>` в psql), успела ли миграция что-то
   изменить.
2. Миграция не успела ничего изменить — пометить её откаченной; api при
   следующем старте применит её заново. Команда — из образа api одноразовым
   контейнером (работает, даже когда api рестартит в цикле):
   ```bash
   docker run --rm --network nodus_net \
     -e DATABASE_URL="postgresql://<pguser>:<пароль>@nodus_postgres:5432/<db>" \
     --entrypoint sh ghcr.io/passat-project/nodus-api:<версия> \
     -c 'cd apps/api && ./node_modules/.bin/prisma migrate resolve --rolled-back <migration_name>'
   node scripts/prod-deploy.mjs --version X.Y.Z
   ```
   Если же объекты миграции применены вручную и совпадают со схемой —
   вместо `--rolled-back` используется `migrate resolve --applied
   <migration_name>` (Prisma CLI reference, `migrate resolve`).
3. Миграция изменила часть схемы и повторно не применяется (например,
   таблица уже создана) — **восстановление из дампа**: крайняя мера, теряются
   данные, записанные после снятия дампа. Только со STOP & ASK владельца:
   ```bash
   docker stop nodus_api
   docker exec nodus_postgres psql -U <pguser> -d postgres \
     -c 'DROP DATABASE <db> WITH (FORCE);' -c 'CREATE DATABASE <db> OWNER <pguser>;'
   gunzip -c D:/NodusProd/backup/pre-<дата>.sql.gz | \
     docker exec -i nodus_postgres psql -U <pguser> -d <db>
   node scripts/prod-deploy.mjs --version X.Y.Z
   ```
   Дамп — из шага 1 (снимается до миграции). Дамп отсутствует — STOP: ручная
   доводка схемы только вместе с владельцем.
4. Записать в issue механизм и выполненные шаги; тег выпуска не удаляется,
   исправление выходит следующим патчем (как в «Откат»).

## Перезагрузка хоста

Контейнеры поднимает `restart: unless-stopped`, туннель — профиль `tunnel`,
который сам не стартует. После перезагрузки: `node scripts/prod-deploy.mjs
--current` (подробнее — `host-reboot.md`).
