# Модуль files (M9: #57 — ADR-0013, #138 — ADR-0014)

Объектное S3-хранилище **SILO** (поддерживаемый форк MinIO от Pigsty,
`silo.pigsty.io`, образ `pgsty/silo`; upstream MinIO архивирован — ADR-0013)

- **движок просмотра офисных вложений ONLYOFFICE** (#138).

* метаданные `file_objects`/`file_versions` (версии: правки ONLYOFFICE
  растят номер, указатель `file_objects.key` — текущая). Первый потребитель
  — chat (вложения сообщений); дальше — correspondence (вложения писем),
  стикеры, аватарки.

## Границы (I3/I13)

- Наружу — порты **`FILE_STORAGE`** (`core/ports/file-storage.port.ts`:
  `save(meta, stream) → {fileId}` и `remove(fileIds)`) и **`AVATAR_PROCESSOR`**
  (`core/ports/avatar-processor.port.ts`, #186: валидация PNG/JPEG/WebP ≤10 МБ
  по magic bytes с пиксельным потолком декодирования 4096² (#231, канон #221 —
  декомпрессионные бомбы) → квадратный WebP-дериват ≤640, реализация `avatars/`).
  Потолок разрешения отдаётся отдельным кодом `FILE_AVATAR_TOO_LARGE_RESOLUTION`
  (details `pixelLimit`, #725): файл не битый, у фото слишком много пикселей —
  интерфейс показывает причину, а клиент (`shared/chat/avatar-compress.ts`)
  даунскейлит фото с телефона до 2048 px до отправки. Оригинал сохраняется
  ПОСЛЕ успешного декода (отказ не оставляет сироту в бакете) и без метаданных:
  EXIF/GPS срезается перекодировкой в свой формат с запечённой ориентацией
  (файлы ≤512 КБ клиент по правилу владельца не пережимает — они приходят с
  EXIF), файл без метаданных хранится байт-в-байт (security-ревью 12.11),
  и **`DOCUMENT_CONVERTER`** (`core/ports/document-converter.port.ts`,
  «Основной документ письма» #56: HTML+ассеты → PDF; реализация
  `derivatives/gotenberg-converter.provider.ts` — Chromium-роут того же
  Gotenberg, A4 с полями; производные #139 остаются на LibreOffice-роуте).
  Модуль `@Global` (как CryptoModule): потребитель инжектит токен без
  межмодульного импорта.
- Обратное направление — реестр **`FileAccessRegistry`**
  (`core/ports/file-access.registry.ts`, #138/#55): право пользователя на файл
  в контексте потребителя. Контрибьютор объявляет `static readonly
fileAccessContext` (`chat`, `letter`), DiscoveryService находит его среди
  провайдеров (multi-токен `FILE_ACCESS_CONTRIBUTORS` упразднён в #55 — второй
  потребитель не требовал правки каждого модуля). files OR-ит решения с
  владением файла (`owner_id`); чужим — 404. Файлы писем: `LetterFileAccess`
  (видимость письма, `canEdit:false` — входящий документ неизменяем).
- Метаданные файлов для чужих DTO — порт **`FILE_OBJECT_READER`**
  (`core/ports/file-object-reader.port.ts`, #55): имя/mime/размер пачкой;
  содержимое — по подписи `SignedUrlService` после проверки видимости.
- **Производные писем:** обработчик `correspondence.letter_received`
  (`events/letter-received.handler.ts`) ставит офисные вложения в очередь
  PDF-копий — тяжёлая работа вне HTTP-запроса.
- `file_objects`/`file_versions` — только через `FilesRepository`.

## Механика

- **Загрузка** (потребитель вызывает порт): стрим → `putObject` в бакет
  `nodus-files` (ключ `files/{fileId}`), счётчик байт сверяется с заявленным
  `size` — расхождение = `FILE_SIZE_MISMATCH`, объект удаляется. Затем
  `file_objects` + `file_versions` (v1) в БД. Потолок хранилища — 200 МБ
  (`STORAGE_MAX_FILE_BYTES` + лимит busboy в main.ts).
  **Порог 64 МиБ** (#713): клиент хранилища до `partSize` буферизует файл и
  делает один PUT, больше — multipart-загрузку (её список и части требуют
  `s3:ListBucketMultipartUploads`/`s3:ListMultipartUploadParts` в политике
  учётки). При сбое `put` отменяет незавершённую загрузку
  (`removeIncompleteUpload`) — иначе брошенные части не убирает никто.
- **Отдача**: `GET /api/v1/files/:id/content?exp&sig[&v=N]` — `@Public`,
  HMAC-подпись (`SignedUrlService`, `STORAGE_URL_SECRET`, TTL 24 ч,
  константное сравнение); ресурс подписи включает версию (`{id}:v{N}`) —
  ссылкой на v2 не открыть v3. URL выпускает потребитель в DTO
  (`fileContentUrl` / `fileVersionUrl`). ETag `{id}-v{N}` → 304;
  Content-Disposition inline (image/*) / attachment; `scan_status=infected`
  → 410 `FILE_QUARANTINED` (сканер — фаза 2/M14, до него pending отдаётся).
- **ONLYOFFICE (#138)**: контейнер `documentserver` (CE 9.4, compose-профиль
  `office`, ADR-0014). Сессия `GET /files/:id/office-session?mode=view|edit`:
  право → конфиг `DocsAPI.DocEditor` целиком на сервере + JWT HS256
  (`OFFICE_JWT_SECRET`); документ-ключ `fileId.v{version}` (алфавит DS —
  `0-9-.a-zA-Z_=`). Callback `POST /files/:id/office-callback` (@Public,
  Bearer JWT DS): статусы 2/6 → скачивание собранного файла (origin →
  `OFFICE_INTERNAL_URL`; fail-closed против SSRF: невалидный/не-http(s) url
  колбэка — `VALIDATION_FAILED`, кривой `OFFICE_INTERNAL_URL` — 500, сырой
  url никогда не запрашивается) → новая FileVersion + указатель + событие
  `file.version_created` (outbox) + аудит `files.office_save` в одной
  транзакции. Скачивание устойчиво к заголовкам (#182): тело читается в буфер
  (потолок 128 МБ) и хранилище получает ТОЧНЫЙ фактический размер —
  отсутствующий/расходящийся content-length (gzip-декодирование, chunked) не
  валит сохранение (расхождение — warn); подпись md5 из url DS — внутренняя
  контрольная сумма их кэша (формат не документирован): расхождение — warn.
  Дедуп: `source_key` +
  `source_lastsave` (повторная доставка и forcesave→закрытие не плодят
  версии) + unique(fileObjectId,version) как страховка ретраев без lastsave.
  `GET /files/office-config` —
  публичные параметры движка (фолбэки реестра); `GET /files/:id/versions` —
  история с подписанными ссылками. Правка — только при `OFFICE_EDIT_ENABLED`
  И праве И редактируемом формате (таблица `contracts/files/office-formats`).
- **Учётка**: `minio-init` (compose) создаёт бакет и сервисного пользователя
  `nodus-api` с политикой только на свой бакет (клиент форка — `mcli`,
  mc-совместимый): объекты + `HeadBucket`/`Location` + `ListBucket` и
  `ListBucketMultipartUploads`/`ListMultipartUploadParts` (последние три
  bucket-level, но узкие — ARN одного бакета; нужны клиенту для загрузок
  > 64 МиБ, #713); root-креды api не получает. Дрейф политики ловит страж
  > `scripts/lib/storage-policy.test.mjs` (шаг `pnpm test:scripts`).
- **Уборка**: брошенные загрузки (неотправленные >48 ч) снимает потребитель
  (chat — при следующей загрузке владельца); незавершённые multipart-загрузки
  отменяются при сбое `put` в том же процессе (обрыв стрима, отказ SDK);
  брошенные жёстким падением процесса (kill/OOM) снимает **периодическая
  уборка** `storage/stale-multipart.job.ts` (#715): repeatable-джоб BullMQ
  (`files-stale-uploads`, раз в `STORAGE_STALE_UPLOAD_INTERVAL_HOURS`,
  Job Scheduler API — upsert по стабильному id) перечисляет незавершённые
  загрузки бакета (`ListMultipartUploads` + `ListMultipartUploadParts` ради
  байт) и отменяет старше `STORAGE_STALE_UPLOAD_AGE_HOURS`
  (`AbortMultipartUpload` по uploadId); загрузку без даты инициации не трогает
  (возраст не доказан), лог-метрика прохода — `scanned/aborted/abortedBytes/
skippedFresh/skippedUnknownAge/failed` (`storage/stale-multipart.sweeper.ts`).
  ILM-правил на незавершённые загрузки в SILO нет; объект-сирота при сбое БД
  после put — редок, уборка фазы 2.

## Env (`env.schema`, fail-fast)

`STORAGE_ENDPOINT` (дефолт 127.0.0.1; в docker — `nodus-minio`),
`STORAGE_PORT` (9000), `STORAGE_USE_SSL`, `STORAGE_BUCKET` (nodus-files),
`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` (сервисная учётка),
`STORAGE_URL_SECRET` (≥32, ≠ JWT_SECRET), `STORAGE_URL_TTL_SECONDS` (86400),
`STORAGE_STALE_UPLOAD_AGE_HOURS` (24 — порог возраста брошенной загрузки),
`STORAGE_STALE_UPLOAD_INTERVAL_HOURS` (24 — период прохода уборки).
Офис (#138): `OFFICE_ENABLED` (default false), `OFFICE_EDIT_ENABLED`,
`OFFICE_JWT_SECRET` (обязателен при enabled), `OFFICE_INTERNAL_URL`
(api→DS, в docker `http://documentserver`), `OFFICE_API_INTERNAL_URL`
(DS→api, в docker `http://nodus-api:3001`), `OFFICE_MAX_VIEW_BYTES` (50 МБ).
Производные (#139): `GOTENBERG_URL` (пусто — конвейер выключен; в docker
`http://gotenberg:3000`, песочница live-stack — `http://127.0.0.1:3100`).

## Конвейер производных (#139)

PDF-копии офисных документов (fallback-просмотр при лежащем движке) в фоне:
`file_derivatives` (уникальность fileObject+version+kind — ключ генерации =
версия; правки ONLYOFFICE перегенерируют). Триггеры — подтверждение вложения
(подписка `events/attachment-sent.handler.ts` на `chat.message_sent`, I3) и
новая версия (office-callback). BullMQ-воркёр `derivatives/` (concurrency 1)
конвертит через Gotenberg word/presentation-семейство; таблицы (xlsx/ods/
csv/tsv) намеренно НЕ конвертятся (спека: PDF-простыня — антипаттерн),
единый список — `contracts/files/attachment-preview` (`isPdfDerivativeCandidate`,
его же читает DTO-маппер чата для `pdfUrl`). Отдача — `GET /files/:id/
derivative/pdf` по подписи (ресурс `${id}:deriv:pdf`, выдаётся в DTO без
похода в БД; неготовая — 404). PNG-иконка первой страницы отложена: стек не
даёт (Gotenberg конвертит только в PDF). Уборка: `findForRemoval` сносит
производные и дериваты вместе с оригиналом (без сирот, #156).

## События и аудит

- `file.version_created` (payload: fileId, version, size, mime) — из колбэка
  ONLYOFFICE, outbox-запись в транзакции версии (I9). Жизненный цикл загрузки
  — деталь потребителя (событие chat `message_sent` уже несёт вложения).
- Аудит: `files.office_save` (actor null — система, детали: версия/статус);
  действия пользователей — на эндпоинтах потребителя
  (`chat.attachment_upload`/`chat.attachment_cancel`).

## Тесты

- Интеграционный `chat-attachments.integration.test.ts` (upload→download на
  живом S3 SILO) — приёмка #57; скипается без `STORAGE_ACCESS_KEY`; включает
  файл 64 МиБ + 1 байт — multipart-путь клиента хранилища (#713).
- Интеграционный `files-stale-uploads.integration.test.ts` (#715): загрузка
  инициируется напрямую клиентом хранилища (брошена, без abort), уборка на
  живом S3 отменяет её по порогу возраста, свежую не трогает.
- Unit: `minio-storage.driver.test.ts` (сбой put → отмена незавершённой
  загрузки и удаление объекта, #713), `stale-multipart.sweeper.test.ts`
  (порог возраста из конфига, свежие/бездатные не трогаются, сбой отмены не
  валит проход, метрика в логе, #715), `office-session.service.test.ts`
  (права/форматы/лимиты/ключи), `office-callback.service.test.ts` (статусы,
  дедуп lastsave, устаревшие ключи, сверка байт), `signed-url.service.test.ts`
  (подпись/TTL/чужой ресурс/версии).
- E2E `tests/e2e/specs/viewer-live.spec.ts`: pdf.js-канвас + офисная ветка
  (редактор при включённом движке / карточка-фолбэк при выключенном).
