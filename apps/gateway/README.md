# apps/gateway — @nodus/gateway

WebSocket-gateway портала (I1: отдельный процесс): Socket.IO — auth-хендшейк,
комнаты бесед, fanout доменных событий всех модулей (`chat.*` включая стикеры, `task.*`,
`workflow.*`, `notification.*`, `directory.user.deactivated`) из Redis Stream,
«печатает…», presence. Спека — issue #104 (трек M13).

## Запуск

- `pnpm dev` — `node --watch src/main.ts` (Node 24 исполняет TS напрямую, type stripping; поэтому относительные импорты — с `.ts`-расширением, tsc переписывает их на `.js` при сборке через `rewriteRelativeImportExtensions`).
- `pnpm build && pnpm start` — прод-режим из `dist/`.
- Порт: `GATEWAY_PORT` (по умолчанию 3002); проверка живости — `GET /health`.
- Env (zod на старте): `JWT_SECRET` (тот же, что у apps/api), `REDIS_URL`, `DATABASE_URL`. В docker-compose переменные пробрасываются сервису.

## Архитектура

- **Fanout**: api после коммита пишет доменные события в outbox (`events`); издатель
  `RedisStreamPublisher` (apps/api, `core/events`) публикует ВСЕ события outbox
  в Redis Stream `nodus:domain:events` (`DOMAIN_EVENTS_STREAM`; опрос хвоста `fanout_at IS NULL`, 50 мс — бюджет
  p95 доставки < 200 мс; метка ставится после XADD, поздно закоммиченное
  событие догоняет следующим тиком — аудит #123). Gateway — consumer group `nodus:gateway` (XREADGROUP
  BLOCK), рассылает envelope **`{ type, payload, seq, ts }`** (канон
  api-conventions.md; seq = events.seq, глобальный порядок) по комнатам из
  payload (`route-envelope.ts`). Группа создаётся на `$` — историю не ретранслируем: клиент,
  пропустивший события, ресинхронизируется рефечем (сервер — истина).
- **Обслуживание группы** (`stream-recovery.ts`; при старте и раз в 30 с,
  МЕЖДУ чтениями на том же соединении — параллельно нельзя, команды встали
  бы за XREADGROUP BLOCK): `XAUTOCLAIM` pending-записей с idle > 60 с —
  падение/рестарт между XREADGROUP и XACK (а consumer-имя с pid после
  рестарта новое) больше не теряет события: брошенные записи забирает
  текущий consumer и обрабатывает штатно (эмит + XACK); затем GC сирот —
  `XGROUP DELCONSUMER` чужих consumer'ов с pending = 0 и idle > 10 мин
  (живой BLOCK-reader обновляет idle каждые ≤ 5 с и под порог не попадает).
- **Деактивация сотрудника**: `directory.user.deactivated` из стрима →
  `io.in(user:{id}).disconnectSockets(true)` — сокет, аутентифицированный
  на хендшейке, не переживает деактивацию; клиент на `io server disconnect`
  сам не переподключается, refresh-сессии отзывает auth тем же событием.
- **READ-ONLY Postgres — осознанное исключение I3/I6** (зафиксировано спекой
  #104): gateway не тянет Nest/Prisma ради нескольких SELECT — `isMember` для
  подписки на комнату, `status` учётки на хендшейке и `display_name/avatar_url` для presence-entries (кэш
  60 с). Пишет в чужие таблицы никогда.
- **Stateless, но пилот — один инстанс**: горизонтальное масштабирование —
  Redis-адаптер Socket.IO (задел; consumer group уже разделяемая). Доступ из
  браузера — один origin с web (nginx/vite проксируют `/socket.io`), свой
  CORS не настраивается.

## Протокол (клиент ↔ gateway)

| Направление     | Событие                               | Payload                                                                                                                                                                                                  |
| --------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| клиент → сервер | `conv:join`                           | `{conversationId}` + ack `{ok, error?}` — подписка на комнату беседы (только член; `bad_request`/`forbidden`/`room_limit`/`unavailable`)                                                                 |
| клиент → сервер | `conv:leave`                          | `{conversationId}`                                                                                                                                                                                       |
| клиент → сервер | `chat.typing`                         | `{conversationId, threadRootId?}` — троттл ~3 с на пользователя-беседу(-тред); рассылка: conv-комната + user-комнаты участников без автора (threadRootId — печать в трэде: ТОЛЬКО conv-комната, раунд 3) |
| сервер → клиент | `chat.*` (каталог api-conventions.md) | envelope `{type, payload, seq, ts}`                                                                                                                                                                      |
| сервер → клиент | `chat.typing`                         | `{conversationId, userId, threadRootId?}` — кроме сокетов автора; threadRootId показывает шапка окна треда, списки бесед его игнорируют                                                                  |
| сервер → клиент | `presence.snapshot`                   | `{entries: PresenceEntry[]}` — подключившемуся                                                                                                                                                           |
| сервер → клиент | `presence.updated`                    | `PresenceEntry` — всем (комната `presence`)                                                                                                                                                              |

Комнаты: `conv:{conversationId}` — join только членам, потолок 50/сокет;
`user:{userId}` — автоматически после auth; `presence` — все аутентифицированные.

Роутинг событий: беседа → `conv:{id}`; `message_sent/edited/deleted` → плюс
user-комнаты участников (список бесед); `message_read` → `conv:{id}` +
`user:{reader}`; `conversation_created/member_added` → user-комнаты затронутых.
**`chat.typing` (раунд 2 #104, модель Telegram; раунд 3 — трэды)**: помимо
комнаты беседы — user-комнаты остальных участников (SELECT members,
механизм message_sent) — индикатор живёт и в СПИСКЕ чатов; автор из
user-рассылки исключён (свои вкладки свою печать не видят), своя печать не
показывается и на клиенте. Печать с `threadRootId` (раунд 3) идёт ТОЛЬКО в
conv-комнату (троттл-ключ включает root): индикатор — шапка окна треда, в
список бесед и шапки каналов не попадает.
`task.*` → user-комнаты из `payload.audience`; `notification.*` → `user:{userId}`.
`workflow.*` (#428, ADR-0024) — только каталожные события (`WORKFLOW_CATALOG_EVENTS`:
`type_created / type_updated / type_archived / published / layout_changed`) → комната
`presence` (схемы видят все); список явный, а не префикс: у ADR-0025 будут
некаталожные `workflow.*` со своей адресацией.
`custom_field.definition_changed`, `dictionary.*` (#431) и `project.node_kind_changed`
(#556, ADR-0030 «Реализация») — каталожные: комната `presence`, явные списки
`CUSTOM_FIELD_CATALOG_EVENTS`/`DICTIONARY_CATALOG_EVENTS`/`PROJECT_CATALOG_EVENTS`;
виды папок без персональных данных, узлы проекта по-прежнему без реалтайма.
`chat.sticker_*` (#318, беседы нет): установка/снятие пака → `user:{userId}`;
содержимое пака — корпоративный → комната `presence` (все аутентифицированные
сокеты), личный → user-комнаты `payload.audience` (владелец + установившие).
`audience` — служебное поле адресации: gateway вырезает его из envelope до
emit для ВСЕХ событий (#328); доменные составы событий беседы
(`memberIds`/`userIds`) — данные события, клиенту остаются.
Клиент применяет события с полным DTO локально в кэш (эхо `message_sent`
заменяет темп по `clientMessageId`, канон api-conventions.md и
`apps/web/src/shared/chat/ws-apply.ts`), остальные — сигнал к инвалидации/
рефечу; порядок seq может нарушаться поздними коммитами транзакций api —
клиент сверяет по seq сообщений беседы, это безопасно.

## Известные границы (заделы)

- **Reconnect-догрузка по seq**: клиент хранит seq (в envelope), но REST-эндпоинт
  `/events?after_seq=` ещё не нужен — после reconnect клиент инвалидирует всё
  чат-дерево ключей и рефечит. Появится при масштабировании истории.
- **Auth**: stateless HS256 (тот же формат, что apps/api); сессии (sid) не
  проверяются — отозванная сессия живёт ≤ TTL access-токена (15 мин).
  Деактивация рвёт уже открытые сокеты (см. выше), а **статус учётки
  перечитывается на каждом хендшейке** (#320, `isActiveUser` — один SELECT
  без кэша): новый хендшейк деактивированного с ещё живым access-токеном
  (перезагрузка вкладки) отклоняется `unauthorized` — refresh у него не
  проходит, клиент остаётся анонимом. Сбой БД на проверке — отказ
  `unavailable` (fail-closed); клиент повторяет с экспонентой без refresh
  (Socket.IO после отказа middleware сам не переподключается).
- **Presence**: только online/offline (away в контракте — задел); эфемерно,
  в БД не хранится. Снимок приходит подключению, обновления — всем.
- Структурное логирование (pino) — вместе с core-механизмами (issue #2/#3).

## Тесты

- Unit (`pnpm test`): auth-верификатор, троттл typing, роутинг fanout
  (включая отключение сокетов деактивированного), обслуживание группы
  (XAUTOCLAIM-перехват + GC сирот), presence-переходы, conv:join/leave
  (членство, потолок, идемпотентность).
- Integration (`pnpm test:integration`, живые PG/Redis): собственный контур —
  БД `nodus_gateway_test` с минимальным срезом читаемых таблиц, Redis — db 15
  (`@nodus/config/test-env`, громкий отказ при чужом db, #332); socket.io-client
  против живого сервера; публикация в стрим XADD-ом contract-ного envelope.
  api-сторона публикации покрыта apps/api/test/integration/chat-realtime-fanout.
- Нагрузка (k6 0.58, `docker run --rm grafana/k6:0.58.0`, из репо
  `MSYS_NO_PATHCONV=1`, api/gateway доступны как `host.docker.internal`):
  - `perf/ws-spike.js` — спайк raw engine.io-фрейминга для k6;
  - `perf/chat-ws-load.js` — прежний профиль: 50 соединений, 10 минут;
  - `perf/super-load.js` — стресс-лестница «предел прочности» (#117): ступени
    300→2000 сокетов, микс операций (отправка 55% / typing 15% / read 15% /
    реакции 10%), метрика доставки на собственном сокете; оркестрация
    `perf/tools/run-ladder.sh`;
  - `perf/churn-storm.js` — волны массовых connect/disconnect (presence-
    snapshot под нагрузкой, утренний вход офиса);
  - `perf/login-storm.js` — честный argon2-логин с постоянной интенсивностью;
  - `perf/hour-soak.js` — часовой профиль НФТ: 300 сокетов, ~500 сообщ/мин,
    p95 < 200 мс, саморазрывы сокетов + внешний рестарт gateway на 30-й
    минуте (массовый реконнект, #119); оркестрация `perf/tools/run-soak.sh`.
- Мир нагрузки: `perf/tools/bots.mjs` генерирует ботов-сотрудников и беседы в БД
  напрямую (SQL для psql) и HS256-токены ботов (payload как у token.service,
  permissions копией реального админа) в `perf/run/world.json` (git-ignored).
  Вычистка: `perf/run/cleanup.sql`. Общий движок бота — `perf/lib/bot-engine.js`
  (engine.io-фрейминг, join по ack, pending-матчинг доставки — событие может
  прийти раньше HTTP-ответа отправки).
- Мониторинг прогонов: `perf/tools/monitor.sh` (CPU/RAM контейнеров, активные
  PG-сессии, события/мин, длина стрима и pending consumer-группы).

### Известная ловушка: два consumer'а в группе `nodus:gateway`

Любой второй живой reader группы (например, забытый dev-gateway на хосте с
`REDIS_URL=redis://localhost:6379`, контур портов это допускает) ЗАБИРАЕТ
записи XREADGROUP'ом и ACK-ает их в никуда — события чата бесследно
теряются для онлайн-клиентов, pending остаётся 0, ошибок в логах нет.
Перед k6-прогонами против прода: `XINFO CONSUMERS nodus:domain:events
nodus:gateway` — активен должен быть ровно один (`gateway-<pid>` контейнера).
Мёртвых consumer'ов gateway чистит сам (GC сирот, см. «Обслуживание группы»),
но живого сироту GC не лечит и лечить не может — он неотличим от второго
инстанса: молчаливая потеря данных, детект — только pre-flight.
