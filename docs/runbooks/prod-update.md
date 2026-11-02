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
- `D:\NodusProd` — прод-данные, не остатки сессий: не удалять и не чистить;
- выпуск содержит миграции — сначала бэкап БД: `docker exec nodus_postgres
  pg_dump -U <pguser> nodus | gzip > D:/NodusProd/backup/pre-$(date +%Y%m%d-%H%M).sql.gz`
  (файл вне репо); «No pending migrations» в логе — не доказательство:
  применённость верифицируется по `_prisma_migrations` (список = локальные
  миграции `apps/api/prisma/migrations/`).

## Шаги

1. Проверить выкатку без изменений на хосте:
   ```bash
   node scripts/prod-deploy.mjs --version X.Y.Z --dry-run
   ```
   Скрипт проверяет `.env`, достаёт kit версии из тега и прогоняет
   `docker compose config --quiet`; `.env`, образы и контейнеры не трогаются.
2. Выкатить:
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
3. Дождаться итога смока в выводе. Красный смок = выкатка не принята, скрипт
   печатает команду отката.

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

## Перезагрузка хоста

Контейнеры поднимает `restart: unless-stopped`, туннель — профиль `tunnel`,
который сам не стартует. После перезагрузки: `node scripts/prod-deploy.mjs
--current` (подробнее — `host-reboot.md`).
