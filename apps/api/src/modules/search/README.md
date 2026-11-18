# Модуль search (ядро)

Единый поиск по порталу (#952): проекция `search_documents` и одно окно
Ctrl+K (без рабочего листа — вердикт владельца 18.11.2026). Ядро, без
фичефлага (I10). Архитектура — ADR-0052.

## Назначение

Ищет по пяти источникам: задачи, письма (метаданные), сообщения чатов,
проекты, сотрудники. Вложения отдельного типа не имеют — имя файла ищется в
контексте письма/сообщения (ответ владельца В3). Векторы/реранк — не здесь:
фаза #272 через `SearchProvider`/`EmbeddingProvider` (ADR-0032).

Подробный план и решения — issue #952, пакеты P0–P4.

## API

| Метод | Путь             | Назначение                                                                            |
| ----- | ---------------- | ------------------------------------------------------------------------------------- |
| GET   | `/api/v1/search` | Поиск по проекции: `q`, `types`, `projectId`, `from`, `to`, `sort`, `cursor`, `limit` |

- Маршрут без `@RequirePermissions` осознанно: доступ фильтруется видимостью
  каждого источника в сервисе (pre-filter портами), причина — в
  `apps/api/src/rbac-inventory.reasons.ts`.
- Ошибки: `VALIDATION_FAILED` (q < 2), `SEARCH_TIMEOUT` (504 —
  `statement_timeout` 3 с, Postgres 57014 / Prisma P2028).
- Только чтение: идемпотентно по природе, `Idempotency-Key` не требуется.

## Данные

- `search_documents` — проекция: одна строка = один источник (PK
  `source_type, source_id`), текст (title/body/keywords), контексты
  (`project_id`, `conversation_id`, `counterparty_id`, `author_id`,
  `participant_ids`), флаги `confidential`/`registered`, `acl_kind`,
  `payload` (номер/рег. номер/шифр/seq), даты источника. Заполняется только
  провайдерами модулей-источников; модуль search не читает чужие таблицы.
- `search_queries` — аналитика запросов (actor, query, types, project,
  период, result_count, took_ms, hint). Пишется best-effort после ответа.
- Индексы: FTS по **раскрытому выражению** `setweight(to_tsvector('russian', …))`
  (SQL-функция `search_tsv` инлайнится — индекс на вызове функции planner не
  видит; миграция `20261201130000_search_tsv_index_fix`), триграммы `pg_trgm`
  по `title` (только оператор `<%`, порог — `SET LOCAL` в запросе), btree по
  точным ключам `payload->>'number' | 'regNumber' | 'code'`, btree
  `lower(title) text_pattern_ops` (равенство/префикс точной ноги), GIN по
  `participant_ids`, btree под скан и pre-filter. Миграции
  `20261201120000_search_core` + `20261201130000_search_tsv_index_fix`.
- Perf-замер (`pnpm search:perf -- --count=50000`): p95 ≈ 70 мс на 50k
  сообщений; цепочка SECURITY — golden-матрица и `EXPLAIN`-гейт в
  `test/integration/search.integration.test.ts`.

## Видимость (P2)

Pre-filter до ранжирования и лимита: `ProjectViewScope`
(`PROJECT_READER`), наборы задач (`TASK_VIEWER_READER` — те же ветви, что
`visibleTasksWhere`), беседы (`CHAT_MEMBERSHIP_READER.readableConversationIds` =
членство без hidden ∪ чаты задач, где пользователь — решающий; гейтованный
`TASK_CHAT_READER.deciderTaskIds`), письма — формулой по полям проекции
(регистратор/адресат/участники/конфиденциальность/«Новые»), сотрудники —
`directory.read` + активность. Никакого post-filter: невидимое не участвует
в выдаче и фасетах.

## Аналитика и эксплуатация

- `search_queries` хранит текст запроса (может содержать чувствительные
  строки): доступа из UI нет, хранение 90 дней, чистка вручную SQL по
  `created_at`; в логи текст запроса не пишется — access-лог API вырезает
  query string `/search` (`core/logging`, сериализатор req), nginx для
  `/api/` access-log не ведёт (`infra/nginx/web.conf`, security-аудит #952).
- Бэкфилл — CLI `pnpm search:reindex` (`--type=task|letter|message|project|employee`,
  `--rebuild`): скан провайдеров пачками 500, upsert идемпотентен; после
  выкатки — шаг runbook `docs/runbooks/prod-update.md`. Perf-замер —
  `pnpm search:perf -- --count=50000` (генератор сообщений, p95, уборка).
- Откат: удалить код, таблицы остаются (expand-only).

## Индексация (P2)

Обработчики outbox: `task.created/updated/assigned/participants_changed/deleted`,
`chat.message_sent/edited/deleted`, `correspondence.letter_received/registered/
updated/participants_changed/deleted`, `project.created/updated`,
`directory.user.created/updated/deactivated/activated`,
`directory.department.updated/archived`, `directory.position.updated/deleted`.
Один runner на группы событий (`eventTypes` на типе конструктора — O1).
Upsert идемпотентен по `source_updated_at`; tombstone (`deleted: true`)
удаляет строку: мягко удалённые задача/письмо/сообщение, архивный проект,
деактивированный сотрудник. Провайдеры: `tasks/ports/task-search-source`,
`correspondence/search/letter-search-source`, `chat/search/message-search-source`,
`projects/ports/project-search-source`, `directory/users-search-source`.

## Границы

- Окно поиска — веб-фича `apps/web/src/features/search/` (P1), пункта в левой
  рейке нет (решение владельца Д2).
- Поиск внутри открытого чата остаётся клиентской панелью мессенджера
  (N1 — отдельная задача).
- Векторы, эмбеддинги, реранк, текст вложений/OCR, реестры и KB — вне v1
  (#272, #636, N2).
