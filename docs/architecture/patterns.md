# Паттерны кода (принятые)

Каркасные паттерны проекта, зафиксированные до первой строки кода — чтобы каждый агент писал одинаково без угадывания. Обязательны; отклонение — через ADR. Детальные паттерны дополняются с первыми модулями (и упаковываются в навыки — `docs/process/skills.md`).

Читать: **перед написанием любого кода** в соответствующем слое.

## Бэкенд (NestJS): слоистость модуля

Каждый модуль `apps/api/src/modules/<name>/` строится одинаково:

```
<name>/
├── <name>.module.ts        # NestJS-модуль: wiring, без логики
├── <name>.controller.ts    # только HTTP: маршруты, DTO (типы из zod-схем contracts), OpenAPI-декораторы. Без бизнес-логики
├── <name>.service.ts       # бизнес-логика, транзакции, оркестрация
├── <name>.repository.ts    # ЕДИНСТВЕННАЯ точка доступа модуля к своим таблицам (Prisma)
├── events/                 # публикация доменных событий и обработчики чужих событий
└── README.md
```

Правила:

- **Repository pattern обязателен.** Prisma вызывается только в `*.repository.ts` модуля, в адаптерах read-портов `*.provider.ts` (ADR-0012: реализация порта — это репозиторий модуля-владельца для чужого потребителя) и в `core/`. Сервис, контроллер и обработчик события не знают SQL/Prisma-клиента — работают с репозиторием через методы предметного языка (`findOverdueByAssignee`, а не `findMany({where: ...})`); методы, вызываемые внутри транзакции, принимают `tx`. Это держит логику тестируемой (репозиторий мокается) и даёт одну точку для индексов/партиций/софт-делита. **Гейт линтера:** импорт `PrismaService` вне `*.repository.ts`/`*.provider.ts` в `apps/api/src/modules/**` — ошибка `no-restricted-imports` (обращения через `tx.<модель>` в сервисе линтер не видит — это ревью).
- **Чужие таблицы — запрещены.** Репозиторий модуля `tasks` не трогает таблицы модуля `chat` (I3, I6). Нужны данные другого модуля → событие или публичный контракт.
- **Controller тонкий:** валидация (zod pipe из contracts) → вызов service → ответ. Никаких `if` по бизнес-правилам.
- **Service без HTTP:** не знает про Request/Response; ошибки — доменные исключения с кодами из `@nodus/contracts`, маппинг в HTTP — глобальным фильтром (core).
- **Сквозное — через core, не руками:** RBAC — guards; аудит и идемпотентность — interceptors core; события — outbox-запись в той же транзакции через core EventBus (I7, I9). В сервисе это выглядит как `await this.eventBus.emit(tx, 'task.created', {...})` — никаких самодельных публикаций мимо outbox.
- **Обработчики событий** — отдельные файлы в `events/` модуля-подписчика, идемпотентные (событие может прийти повторно). Диспетчер outbox вызывает обработчик ВНЕ своей транзакции (у обработчика свои через `TransactionRunner`), фиксирует доставку по каждому обработчику отдельно и уводит упорно падающее событие в бэкофф — см. `core/README.md`.
- **Направление слоёв api:** `modules → core`, не наоборот (гейт boundaries: `core` не импортирует модули; обратная связь — порт в `core/ports` или событие). Приложения монорепо (`web`, `api`, `gateway`) код друг друга не импортируют — только `packages/*` (гейт boundaries).
- **Адаптер сущности (паттерн contributors, ADR-0012/ADR-0024).** Платформенный движок работает с сущностями чужих модулей только через порт-адаптер: интерфейс в `core/ports/<область>.port.ts` (`WorkflowEntityAdapter` — `lock`, `subject`, `applyStage`, `countByStages`, `migrateStage`, `restateStage`), реализация — в модуле-владельце данных (`tasks/workflow/task-workflow.adapter.ts`). Регистрация — `DiscoveryService` при bootstrap по статическому маркеру (`static readonly workflowCategory`, как `eventType` у обработчиков): токен-массив как у `FILE_ACCESS_CONTRIBUTORS` не складывается из двух модулей, а адаптеру нужны доменные провайдеры владельца. Методы, меняющие данные, вызываются **в транзакции вызывающего**; движок чужих таблиц не пишет. Фоновые операции (перенос, пересчёт) — тоже через адаптер: он сам держит пачки, свои транзакции и идемпотентность. Новый адаптер — новый файл `*-workflow.adapter.ts` у владельца + `static workflowCategory`, без правок движка.
- **Промисы:** type-aware правила `no-floating-promises`/`no-misused-promises` — ошибки линтера в api/gateway/web. Намеренный «выстрелил и забыл» — `void promise` с обработкой ошибки внутри.

## Core-примитивы (канонические имена и пути)

Код использует только эти имена и пути. Альтернативные варианты (`DomainError`, `UnitOfWork`, `@CurrentUser`, `@OnEvent`, `SessionUser`...) **запрещены** — они расходятся между файлами. Реализация — в issue «Core: сквозные механизмы»; при расхождении кода с этой таблицей правится код и таблица в том же коммите.

| Примитив | Канон | Назначение |
|---|---|---|
| Доменное исключение | `DomainException` — `apps/api/src/core/errors/domain-exception.ts` | Единственный тип ошибок из сервисов (не HTTP-исключения); несёт `ErrorCode` + details |
| Коды ошибок / тип ответа | `ErrorCode`, `ApiErrorResponse` — `packages/contracts/src/errors/` | Базовый набор — `api-conventions.md`; доменные коды — по маске `MODULE_REASON` |
| Транзакции | `TransactionRunner` — `core/database/transaction-runner.ts` | Сервис: `this.txRunner.run(async (tx) => …)`; tx передаётся в репозиторий и `eventBus.emit(tx, …)`. `PrismaService` — только в репозитории, `infra/` и самом runner |
| Шина событий | `EventBus` — `core/events/event-bus.ts` | `emit(tx, 'module.action', payload)` — outbox-запись в той же транзакции; самодельные публикации запрещены |
| Обработчик события | `events/<событие>.handler.ts`, `static readonly eventType` | Регистрируется core при bootstrap; декораторы подписки (`@OnEvent`) запрещены; обработчик идемпотентен (дедуп по event id) |
| Таблица outbox | `events`: id, type, actor_id, aggregate_type, aggregate_id, payload JSONB, created_at, published_at | Append-only, по `data-model.md`; пишется только через EventBus |
| Валидация | `ZodValidationPipe` — `core/pipes/zod-validation.pipe.ts` | Схема из contracts передаётся явно: `@UsePipes(new ZodValidationPipe(createTaskSchema))` |
| Текущий пользователь | `@GetUser()` декоратор; тип `AuthUser` — `packages/contracts` | Не `@CurrentUser`/`SessionUser` |
| Права | `Permission` enum в contracts (`task.create` — точечная нотация); guard — `core/guards/permission.guard.ts`; декоратор `@RequirePermissions(Permission.TASK_CREATE)`; маршрут без права (мутирующий и читающий) — только строкой с причиной в `apps/api/src/rbac-inventory.test.ts` (проверка доступа или фильтр видимости в сервисе: членство/владение/участие, #320/#334) | Не строковые литералы прав; маршрут без решения по правам (тест-инвентаризация красная) |
| Логирование | nestjs-pino (`PinoLogger`); `traceId` = Fastify `request.id` | Не кастомный AppLogger в request-scope |
| Ответ списка | `{ items, nextCursor }` | Без totals/offset/pageInfo |
| OpenAPI-ошибки | `ApiErrors(...статусы)` — `core/openapi/api-errors.decorator.ts` | Общая схема `apiErrorResponseSchema`, без ручных `@ApiResponse` |
| OpenAPI-идемпотентность | `@ApiIdempotencyKey()` — `core/openapi/api-idempotency.decorator.ts` | Заголовок `Idempotency-Key` на мутациях |

## Бэкенд (NestJS): OpenAPI-аннотации (спека из кода, I2)

Спецификация генерируется `@nestjs/swagger` из декораторов и публикуется на `/api/docs`
только для авторизованных (ADR-0006). Источник схем — **те же zod-схемы `@nodus/contracts`**,
что валидируют вход: одна схема = валидация + типы + документация (без дублирования).
Классические DTO с `@ApiProperty` **запрещены** (противоречит ADR-0001).

Правило: **новый/изменённый эндпоинт = аннотации в том же коммите** (критерий приёмки,
дублирует DoD «Изменение API = обновлены … и OpenAPI-аннотации»).

```
# Тело и query: schema — в опции декоратора маршрута (нативный Standard Schema, zod 4).
# pipes — валидация единым форматом; опция schema на рантайм не влияет.
@Post()
@ApiOkResponse({ standardSchema: userCardSchema })          # ответ — выходная сторона схемы
@ApiErrors(400, 401, 403, 409)                              # ошибки единого формата
@ApiIdempotencyKey()                                        # мутация → заголовок идемпотентности
create(@Body({ schema: createUserSchema, pipes: [new ZodValidationPipe(createUserSchema)] }) dto: CreateUserDto) { … }

@Get()
@ApiOkResponse({ standardSchema: paginatedSchema(userListItemSchema) })
list(@Query({ schema: listUsersQuerySchema, pipes: [new ZodValidationPipe(listUsersQuerySchema)] }) q: ListUsersQuery) { … }
```

Правила аннотирования:

- **Тело/параметры** — опция `schema` у `@Body`/`@Query` (массив `pipes` рядом); **ответы** — `standardSchema` у `@Api…Response`. Ответ — выходная сторона (`output`), тело — входная (`input`): конвертирует сам `@nestjs/swagger`.
- **Ошибки** — только через `@ApiErrors(…)` (общая схема `apiErrorResponseSchema`); не расписывать `@ApiResponse` для каждого кода вручную.
- **Мутации** (POST/PUT/PATCH/DELETE) — `@ApiIdempotencyKey()`; чтение — нет.
- **Безопасность** — контроллер/метод под `@ApiBearerAuth()`; публичные — `@Public()` и БЕЗ `@ApiBearerAuth` (health, login/refresh/logout).
- **Теги** — `@ApiTags('<модуль>')` на контроллере (`health`, `auth`, `directory`).
- **Списки** — ответ `paginatedSchema(itemSchema)`; query — курсорная схема (канон `{ items, nextCursor }`).
- **Терминус** (`/health/live|ready`) — своей zod-схемы нет, описывается локальным `SchemaObject` в контроллере.
- `/api/docs*` зарегистрирован в обход конвейера Nest, поэтому закрыт отдельным middie-посредником (`core/openapi/docs-auth.middleware.ts`), а не `JwtAuthGuard`.

## Фронтенд (React): структура фичи

Каждая фича `apps/web/src/features/<name>/` — зеркало backend-модуля:

```
<name>/
├── api/          # query keys factory + хуки TanStack Query + мутации (optimistic)
├── components/   # UI-компоненты фичи (глупые, на props)
├── pages/        # страницы (роутинг, композиция)
├── model/        # локальное состояние (Zustand) — ПО НЕОБХОДИМОСТИ: у большинства фич сторы живут рядом с потребителями (shared/, app/shell)
└── README.md
```

Правила:

- **Query keys — только через factory** (`tasksKeys.list(filter)`, `tasksKeys.detail(id)`) в `api/`: инвалидация и оптимистичные апдейты опираются на них, руками строки ключей не пишутся.
- **Направление слоёв web (аудит #45):** `app` (композиция) → `features` → `shared`; линтером режутся `shared → features` и `shared → app` (eslint-boundaries). `features → shared` — свободно. `features → app` — ТОЛЬКО публичное API каркаса: `use-card-stack.ts` / `card-stack.ts` (стек карточек), `slider-panel.tsx` (типы/панель), `circuit-geometry.ts` (CIRCUIT_REMEASURE), `nav-registry.ts`, `logo-icon.tsx`, `right-rail.tsx` (`useRailShrink` — сжатие карточек при правом рельсе); всё остальное из `app/shell` фичам запрещено (линтером не выражается — ревью). Shared-слою карточки открывает мост `shared/lib/card-bridge.ts` (порт-адаптер: app-shell регистрирует реализацию).
- **Оптимистичная мутация — единый паттерн** (I4). Отклонение (пессимистичная мутация) — только с обоснованием в README фичи (юридически значимые действия):
  - `onMutate`: `cancelQueries` затронутых ключей → снапшот кэша → `setQueryData`: вставка временной записи с `id: temp-<uuid>` и флагом pending. Вставка — **только в те кэши списков, чьим фильтрам запись удовлетворяет**; в infinite-кэш — в первую страницу.
  - **Ключ reconcile (#243):** временная запись несёт стабильный клиентский ключ (у сообщений — `clientMessageId` = `Idempotency-Key`, маркер летящего — `seq: 0`). Ид записи при подтверждении МЕНЯЕТСЯ (сервер выдаёт свой) — связка темп↔серверная запись и все клиентские привязки (селект, диапазоны, эхо) живут по ключу, не по id.
  - `onError`: откат + toast (строка из i18n). Откат по снапшоту безопасен для одиночной мутации; при ПАРАЛЛЕЛЬНЫХ мутациях в один кэш (шквал) снапшот затирает соседние темпы и чужие события — точечное удаление своей записи.
  - `onSuccess`: серверный DTO заменяет темп **на месте** (upsert): темп найден — замена; уже заменён (WS-эхо/рефеч) — не дублируем; отсутствует — вставка перед хвостом более поздних темпов.
  - `onSettled`: инвалидация затронутых ключей. Исключение (#243): когда onSuccess применил точную серверную запись, а WS-событие несёт полный DTO, мутация НЕ рефечит список (шквал отправок не должен дёргать ленту рефечами; рефеч страницы переносит летящие темпы и догруженную историю мерджем — `feed-merge.ts`, маркер `oldestLoadedSeq` #307).
  - **Исходящая очередь per-сущность (#243):** шквал мутаций в одну сущность (беседа) сериализуется на клиенте (`send-queue.ts`): сервер назначает порядок приёму (seq), очередь даёт «порядок кликов = порядок записей навсегда»; темп вставляется мгновенно при клике (мгновенность I4 не страдает), ошибка головы не рвёт хвост. Канон Telegram/Slack (research #243).
  - Детерминированный тест: ответ сервера обёрнут в контролируемый deferred; assert — запись в кэше до resolve; затем reject → assert отката. Шквал — серией deferred с проверкой порядка/стабильности позиций (`burst-send.test.tsx`).
- **Данные — только через хуки `api/`.** Компоненты не дёргают fetch/axios напрямую.
- **HTTP-контур — единый `shared/api-client.ts` (аудит #45, канон для бэк-фазы):** единственный `fetch` в проекте. Access-токен — только в памяти (`shared/auth-store.ts`, не localStorage), refresh — httpOnly-cookie `nodus_refresh`; 401 → один прозрачный refresh с дедупом параллельных вызовов (`refreshInFlight`) → повтор запроса. Ошибки — `ApiError { code, message, status, details?, traceId? }` из единого envelope `{ code, message, details?, traceId }`. Каждая мутация (POST/PATCH/DELETE) автоматически несёт `Idempotency-Key: <uuid на вызов>` (I7); ручной retry той же операции передаёт явный `idempotencyKey`. MSW управляется флагом `VITE_API_MOCK`: `true` — все домены на моках, `false` — все на живом API, список доменов через запятую — покомпонентный режим (перечисленные домены на моках, остальные на живом API); в покомпонентном режиме мок-хендлеры берут актёра из живого auth-стора, а не из статических демо-данных; хендлеры валидируют тела zod-схемами contracts.
- **persist-сторы — с zod-валидацией rehydrate (I7):** zustand `persist` + `merge: zodPersistMerge(envelopeSchema)` (`shared/lib/persist-zod.ts`) + `version` (смена формы состояния = bump версии, сохранённое отбрасывается); ключи `nodus-*-v1`. Известное ограничение: вкладки одного браузера не синхронизируются (storage-event не слушается; последняя пишущая побеждает) — снятие ограничения при переезде настроек на API.
- **Формы — честный канон (аудит #45, вердикт владельца):** простые формы (1–3 поля, локальная валидация) — контролируемые компоненты на `useState` + zod-схема из `@nodus/contracts` для валидации значений; тяжёж react-hook-form без серверной валидации не окупается — RHF-зависимости НЕ держим «про запас». **react-hook-form + zodResolver возвращается с первой формой под серверную валидацию** (ошибки полей с бэка, wizard-многошаговость): тогда — единый паттерн RHF + zod-схема contracts (одна схема на фронт и бэк), зависимости добавляются в том же issue.
- **Моки MSW** — хендлеры фичи в `api/mocks/`, данные соответствуют контрактам (ADR-0001); мок ≠ контракту = баг.
- **UI-примитивы — из `@nodus/ui`**, не из локальных копий; токены темы не зашивать в компоненты (см. `docs/product/ux-principles.md`).
- React-нюансы (производительность, композиция) — навыки `react-best-practices` и `react-composition-patterns`, вызывать при работе с компонентами.

## Контракты (`packages/contracts`)

- Всё общее между фронтом и бэком — здесь и только здесь: zod-схемы DTO, типы событий, коды ошибок, константы прав, i18n-строки.
- Запрещено: дублировать DTO/типы в apps; бизнес-логика и вычисления в contracts (только схемы, типы, константы); зависимости contracts от других пакетов.
- Единственное исключение — **общая грамматика и реестры форматов, которые обязаны совпадать байт-в-байт на фронте и бэке** (парсер токенов упоминаний `chat/mention-tokens.ts`, реестр офисных форматов `files/office-formats.ts`, вид превью вложения `files/attachment-preview.ts`, type-guard ответа ошибки; с #378 — также проверки схемы маршрута `workflows/workflow-document-check.ts`: живые подсказки редактора и серверная валидация публикации обязаны видеть одинаковые правила; с #431 — грамматика значений кастомных атрибутов `custom-fields/custom-field-values.ts`, ключ окна/гейта `custom-fields/custom-field-key.ts` и форма определения `custom-fields/custom-field.schemas.ts` (`checkDefinitionShape`): редакторы веба, моки и сервер дают одинаковые отказы; с #432 — грамматика формы создания `workflows/creation-form.ts` (`checkCreationForm`, `slotLabel`, `defaultCreationForm`), конфигурация типа `workflows/process-type-config.ts` (`normalizeTypeConfig`, `typeAccessFor` — доступ к типу считают веб, моки и сервер одной функцией) и связка формы с телом создания `tasks/task-create-form.ts` (`applyCreationPresets`, `missingCreateFields`, `clearedRequiredKeys`)): чистые функции без состояния и I/O, с unit-тестами в contracts. Две копии одной грамматики в apps — источник рассинхрона, поэтому она живёт рядом со схемой, которую обслуживает (обоснование — ADR-0021).

## Тесты

- **Unit (Vitest):** рядом с кодом (`<сущность>.test.ts`), AAA (arrange/act/assert), бизнес-правила сервисов — с моком репозитория. Новая логика = тест в том же коммите.
- **Покрытие (Vitest v8, #593):** `pnpm test:coverage` — per-package пороги-храповики в `vitest.config.ts`/`vite.config.ts`; CI job `quality` гоняет тесты с покрытием, падение ниже порога валит прогон, сводка по пакетам — в summary прогона. Порог повышается осознанно вместе с тестами, не автоматически; генерируемый Prisma-клиент, декларации и моки MSW из покрытия исключены.
- **Детерминированный тест оптимистичности:** мутация применена к кэшу клиента до resolve ответа сервера (без миллисекундных ожиданий — через контролируемый deferred).
- **E2E (Playwright):** только критичные пути (`docs/product/core-flows.md`), селекторы — role-based (`getByRole`), не CSS-классы; агент работает через `@playwright/cli`, тесты в CI — `npx playwright test`.
- **Интеграционные (API):** контрактные по OpenAPI, outbox, идемпотентность — на реальной тестовой БД (docker), не моках.

## Типичные ошибки (запрещено)

- Prisma в service/controller; импорт чужого репозитория; бизнес-`if` в контроллере.
- `fetch` в компоненте; строки query keys руками; пессимистичная мутация без обоснования.
- Дубль DTO в apps вместо contracts; публикация события мимо outbox; обработчик события без идемпотентности.
