# views — сохранённые настройки списков и выгрузка CSV (#435)

Модуль платформы (фичефлага нет): «вид» — СОХРАНЁННАЯ НАСТРОЙКА списка, не
отдельная сущность данных и не раздел навигации. Условия вида — предикаты
общей выборки #635 (`packages/contracts/src/lists/list-view.schemas.ts`);
сам список считает модуль-владелец сущности (ext-конвейер: `GET /tasks`,
`GET /letters`, `GET /projects/:id/folders`).

## Что внутри

- `saved-views.repository.ts` / `saved-views.service.ts` — таблица
  `saved_views`, три уровня (`personal` / `project` / `type_default`) и три
  рамки (`journal` / `project` / `type_default`). Рамка — место хранения:
  «снять нельзя» (проектная вкладка всегда фильтруется своим projectId —
  фильтр рамки ставит СЕРВЕР, не запрос). Уровень `project` создаётся только
  руководством проекта (manager/assistant или `project.manage`), `personal` —
  участником рамки (в журнале — любой), `type_default` — `workflow.manage`.
  Секретный проект не-участнику — 404 без оракула.
- `list-export.service.ts` + `views-export.queue/worker.ts` — CSV-выгрузка
  «как на экране»: до `LIST_VIEW_LIMITS.csvSyncRows` (1000) строк — файл в
  ответе запроса (`done` + подписанная ссылка `/files/:id/content`), больше —
  BullMQ-очередь `views-export` (jobId = `views-export-<exportId>`, attempts
  3, экспоненциальный backoff; статусы `queued/running/done/failed`).
- `list-export-source.port.ts` — порт источников строк: реализации в модулях
  сущностей (`tasks/ports/task-list-export-source.provider.ts`,
  `correspondence/ports/letter-list-export-source.provider.ts`,
  `projects/ports/folder-list-export-source.provider.ts`) — та же видимость,
  рамка, фильтр и сортировка, что у ext-списков. Массив источников собирается
  фабрикой в `views.module.ts` (Nest не мержит один токен из нескольких
  модулей).

## Контракты

- `GET /views?journal=true[&entity=]` — личные настройки журнала;
  `GET /views?projectId=` — общие проектные + личние пользователя + списки
  типов, создаваемых в этом проекте (#665 «где создаётся»); `GET
/views?typeId=` — каталог настроек типа (только `workflow.manage`).
- `POST /views` (Idempotency-Key) — `{name, entity, scope, level?, filter,
sort, group?, totals, columns}`; `PATCH /views/:id` — частичная замена
  разделов (рамку/уровень не меняют); `DELETE /views/:id` — физическое
  удаление (вид — настройка, не данные; мягкой пометки нет).
- `POST /views/export` (Idempotency-Key) — `{entity, scope, filter, sort,
columns}` → `done {fileId, url}` или `queued {exportId}`; `GET
/views/export/:id` — статус (только автор; чужой — 404).

## Правила

- Событий НЕТ (I13): потребителей нет — списки читаются явным GET при
  открытии; realtime для настроек не заводим. Мутации — в аудит
  (`saved_view.create/update/delete/export`).
- CSV: UTF-8 c BOM, разделитель `;`, CRLF, кавычки RFC 4180
  (`core/lists/list-csv.ts`); заголовки — метки системных полей/имена
  атрибутов из i18n contracts (`ru-lists.ts`). Деньги печатаются суммой без
  валюты (единая валюта портала на пилоте).
- Удалённый атрибут: фильтр вида с ним клиент помечает «удалён» и не шлёт
  (сервер на неизвестное поле — 422 `LIST_FIELD_INVALID`); колонка CSV
  удалённого атрибута — пустые значения с пометкой в заголовке.
- Видимость экспорта — видимость автора на момент ЗАКАЗА (снимок прав в
  `list_exports.actor_json`): фоновый воркер считает «как на экране».
- Папки (`entity=folder`) существуют только в рамке проекта: экспорт с иной
  рамкой — 422.
