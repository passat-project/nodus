# Runbook: включение приёма почты на проде

**Цель:** общий ящик читается порталом — письма появляются в «Корреспонденции →
Новые» сами (IMAP IDLE), без ручной загрузки. Подсистема — #56, ADR-0035.

**Предусловия:**

- у учтённой записи ящика в Kerio включён **доступ извне** (IMAP 993): без него
  сервер отвечает `NO Authentication failed`, а серия отказов включает
  анти-брутфорс и банит хост на 15–30 минут (#56, 23.10);
- с прод-хоста доступен `imap.passatproekt.by:993` (проверено песочницей на том
  же хосте; Kaspersky не подменяет цепочку — исключение сделано 23.10);
- выкачена версия с проводкой `MAIL_*` в контейнер `api` (#577): в
  `docker-compose.yml` сервиса `api` есть блок `MAIL_IMAP_*`.

## Шаги

1. Заполнить боевой `.env` прод-каталога (`D:\NodusProd\.env`) — значения без
   кавычек, код снимает кавычки dotenv-семантикой. Если в пароле есть `$`,
   `#` или пробелы — обернуть значение в **одинарные** кавычки
   (`MAIL_IMAP_PASSWORD='p$ss#word'`): compose не подставляет переменные в
   одинарных кавычках, а `MailReceptionConfig.unquote` снимает их сам
   (проверено `docker compose config` 03.11: без кавычек `$abc` выпадает из
   значения, с двойными — тоже подставляется; `#` без пробела перед ним
   остаётся частью значения):

   ```dotenv
   MAIL_IMAP_HOST=imap.passatproekt.by
   MAIL_IMAP_PORT=993
   MAIL_IMAP_USER=<ящик>@passatproekt.by
   MAIL_IMAP_PASSWORD=<пароль>
   MAIL_POLL_MINUTES=10
   # отправка (когда понадобится):
   MAIL_SMTP_HOST=smtp.passatproekt.by
   MAIL_SMTP_PORT=587
   MAIL_SMTP_USER=<ящик>@passatproekt.by
   MAIL_SMTP_PASSWORD=<пароль>
   MAIL_FROM_ADDRESS=<ящик>@passatproekt.by
   ```

2. Пересоздать `api` с новыми переменными — штатной выкаткой текущей версии
   (runbook `prod-update.md`):

   ```bash
   node scripts/prod-deploy.mjs --version <текущая X.Y.Z>
   ```

   Ключи `.env` подставляются в контейнер только при создании контейнера:
   `docker restart` их не подхватит.

3. Включить рубильник `mail-reception` в БД (default `false`, экрана в UI пока
   нет). Команда работает и в PowerShell, и в bash:

   ```bash
   "UPDATE feature_flags SET enabled = true, updated_at = now() WHERE key = 'mail-reception';" \
     | docker exec -i nodus_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```

   В PowerShell — то же самое одной строкой (обратный слэш не нужен):

   ```powershell
   "UPDATE feature_flags SET enabled = true, updated_at = now() WHERE key = 'mail-reception';" | docker exec -i nodus_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```

4. Проверить состояние:

   ```bash
   docker exec nodus_api printenv | grep '^MAIL_'
   docker logs nodus_api --since 5m 2>&1 | grep -E 'IMAP|Приняты письма'
   "select code, uid_validity, last_uid, consecutive_failures, last_error from mail_sources;" \
     | docker exec -i nodus_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```

   Ожидаемо: `MAIL_*` в контейнере есть, в логе `IMAP подключён, приём активен`,
   `consecutive_failures = 0`. Если в логе
   `Приём почты выключен: не заданы MAIL_IMAP_*` — шаг 2 не пересоздал контейнер
   (или ключи не в том `.env`); `Приём почты выключен флагом mail-reception` —
   не выполнен шаг 3.

5. Приёмка: отправить **новое** письмо на ящик и подождать до 10 секунд (IDLE).
   Письмо должно появиться в «Новых»; в логе — `Приняты письма`.

   Письма, лежавшие в INBOX до включения, намеренно не импортируются: первый
   запуск ставит курсор на максимум UID (В5, чтобы не затянуть архив Е-дела).
   Поэтому письмо, отправленное до включения, после включения не появится —
   отправляйте тестовое заново.

## Откат

Выключить рубильник (соединение разорвётся само, без рестарта):

```bash
"UPDATE feature_flags SET enabled = false, updated_at = now() WHERE key = 'mail-reception';" \
  | docker exec -i nodus_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Полное выключение — убрать `MAIL_*` из `.env` и пересоздать `api` (шаг 2).

## Диагностика отказов

| В логе | Причина | Действие |
| --- | --- | --- |
| `Приём почты выключен: не заданы MAIL_IMAP_*` | контейнер без переменных | шаг 2; `docker exec nodus_api printenv \| grep ^MAIL_` |
| `Приём почты выключен флагом mail-reception` | рубильник выключен | шаг 3 |
| `IMAP: отказ авторизации — проба через 15 минут` | неверный пароль или нет доступа извне в Kerio | проверить учётку; не частить с повторами (бан хоста) |
| `IMAP недоступен` + `Реконнект IMAP` | сеть/файрвол/сертификат | с прод-хоста: `Test-NetConnection imap.passatproekt.by -Port 993` (PowerShell) или `openssl s_client -connect imap.passatproekt.by:993 -brief` (Git Bash) |
| `Цикл приёма не удался` ×3, событие `correspondence.mail_sync_failed` | письмо/папка/курсор | `last_error` в `mail_sources` |
