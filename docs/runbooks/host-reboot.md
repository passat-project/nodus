# Перезагрузка хоста (Windows + Docker Desktop)

**Цель:** вернуть nodus.by в строй после перезагрузки Windows (Windows Update,
сбой питания, ручная перезагрузка) без потери данных и без ожидания человека
«по расписанию».

**Предусловия:**

- Docker Desktop установлен; включён автозапуск: Settings → General →
  «Start Docker Desktop when you sign in to your computer» (и задача
  Task Scheduler на случай, если автозапуск сброшен обновлением);
- репозиторий на месте (`D:\Project\AI\nodus`), `.env` заполнен;
- Docker Desktop с `restart: unless-stopped` сам поднимает контейнеры НОДУСА
  при старте демона — исключением является туннель: `cloudflared` живёт в
  профиле `tunnel` и без явного профиля не стартует.

**Шаги:**

1. Дождаться демона Docker: `docker ps` отвечает без ошибки (если Docker
   Desktop не стартовал сам — запустить его и дождаться готовности).
2. Поднять стек ВМЕСТЕ с туннелем:
   `node scripts/prod-deploy.mjs --current` (готовые образы версии из
   `D:\NodusProd\.env`, профили `office,tunnel`; сборки нет)
3. Дождаться здоровья: `docker ps` — `nodus_web`, `nodus_api`,
   `nodus_gateway`, `nodus_postgres`, `nodus_redis`, `nodus_minio`,
   `nodus_cloudflared` в статусе healthy/running.

**Проверка:**

- `curl -s https://nodus.by/api/v1/health` → JSON 200;
- браузер: nodus.by открывает логин, вход учёткой пилота работает;
- WS: в открытом чате сообщение с второй сессии приходит без перезагрузки
   страницы.

**Откат:** не требуется (процедура подъёма). Если контейнер не healthy —
`docker logs nodus_<имя>` и соответствующий раздел gotchas; данные живут в
томах `nodus_pgdata`/`nodus_redisdata`/`nodus_miniodata` и перезапусками не
трогаются.
