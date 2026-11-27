# Модуль workflows (API) — «Процессы»

Единый движок маршрутов компании (ADR-0024, эпик #377): типы процессов, маршруты (стадии, переходы, правила), редактор и публикация версиями (ADR-0021), холст (ADR-0022), системный каталог «засев один раз», фоновый перенос сущностей публикации. **Ядро платформы** — фичефлага нет (I10).

Читать: перед работой с процессами, типами, маршрутами, переходами и публикацией; перед подключением новой сущности (письма — модуль `correspondence`) к движку.

## Что здесь живёт

- `process_types` — типы процессов: категория `task | letter` (неизменяема), направление письма, значок/цвет/описание, `creatable`, системность, порядок, архивация, `customized_at` + `catalog_revision` («засев один раз»).
- `workflows` (`kind: task | letter`), `workflow_stages`, `workflow_transitions`, `workflow_actions`, `workflow_schemes`, `workflow_scheme_entries` — маршрут типа: стадии-колонки, кнопки-переходы и действия без смены статуса (#633) с закрытым реестром правил (`conditions` / `validators` / `postFunctions`), версия публикации, раскладка холста.
- `transition_records` — общий журнал переходов (схема ADR-0024 п.4, создан пустым в #428; пишет движок в #380).
- **Временное исключение ADR-0024:** личные маршруты «Моего плана» (`workflows.kind = personal`) и их стадии — данные модуля `tasks` до #438/#439. Здесь они не читаются и не пишутся; редактор отдаёт на них 404. Засев шаблона — `PersonalTemplateBootstrap` модуля задач.

## Движок и адаптеры сущностей

Движок не знает ни таблиц сущностей, ни их прав и ролей. Модуль-владелец сущности регистрирует **адаптер** (порт `core/ports/workflow-entity.port.ts`, паттерн contributors ADR-0012):

| Метод                                       | Что делает                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `lock(tx, id)`                              | блокировка строки сущности на транзакцию (сериализация переходов)                                                           |
| `subject(tx, id, actor)`                    | роли актора, флаги «проходит условия всегда» / «может обходить гейты» / «пустые условия = может», факты гейтов и `route_if` |
| `applyStage(tx, id, target, actorId, meta)` | применение смены стадии **в транзакции вызывающего** (события, денормализации, проекции — забота владельца)                 |
| `countByStages(stageIds, tx?)`              | счётчики для диалога публикации и меты списка типов                                                                         |
| `migrateStage(from, to)`                    | фоновый перенос сущностей архивированной стадии (своя транзакция на сущность, пачки)                                        |
| `restateStage(stageId, state)`              | пересчёт сущностей после смены системной группы стадии                                                                      |

**Регистрация** — `DiscoveryService` при bootstrap по статическому маркеру `static readonly workflowCategory` (тот же приём, что `eventType` у обработчиков событий). Почему не @Global-токен как `FILE_ACCESS_CONTRIBUTORS`: токен не складывается из двух модулей, а адаптеру нужны доменные провайдеры своего модуля. Канон ADR-0024 сохраняется: интерфейс в `core/ports`, реализация у владельца данных. Две категории с одним адаптером — ошибка сборки графа.

Два адаптера: `tasks/workflow/task-workflow.adapter.ts` (категория `task`) и `correspondence/workflow/letter-workflow.adapter.ts` (категория `letter`, #55). Новый владелец сущности подключается тем же портом.

## Порты для владельцев (ADR-0012)

`WORKFLOW_FIELD_USAGE_READER` (#431, ревизия #631) — «где атрибут используется»: ищет ключ `cf.<id>` в опубликованных документах маршрутов (окно, `fields_required`, условие решающего `decider_in`) и в формах создания — включая непубликуемые черновики (`draft: true`). Окно удаления показывает последствия, но удаление и снятие привязки больше не блокирует (О3 #631); сам таблицы процессов модуль атрибутов не читает.

`workflows-ports.module.ts` — единственная допустимая форма межмодульного импорта; доменные сервисы наружу не экспортируются.

- **`WORKFLOW_ENGINE`** (`ports/workflow-engine.port.ts`): `available(tx, id, category, actor)` и `execute(tx, id, category, actor, choice, opts)` — **в транзакции вызывающего**. Порядок ведёт движок: замок → субъект → условия «кто» → гейты → обход (флаг адаптера + причина) → применение адаптером. Чужие таблицы движок не пишет.
- **`PROCESS_CATALOG_READER`** (`ports/process-catalog-reader.port.ts`): `resolveType` (категория/архив/скрытость/**доступ с актором** — #432), `typeById`, `typeRefs(ids, { live })`, `liveStages`, `stagesByIds`, `findLiveStage`, `stagesCatalog({ typeId?, category, viewerId? })` — гидратация DTO, каталог стадий и проверка доступа к типу.
- **`ROLE_MEMBERSHIP_READER`** (`core/ports/role-membership.port.ts`, ADR-0034) — эффективные роли с кодом (`effectiveRoles`), по ним считается доступ к типу; привязан в `WorkflowsPortsModule`, чтобы порт каталога не зависел от HTTP-модуля auth.

## API (`/api/v1/workflows`)

| Метод и путь                                 | Право             | Что                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /workflows/types?archived=&category=`   | любой вошедший    | Типы процессов: `category`, `direction`, `workflowId`, **`config`, `creationForm`, `viewer`**; без `workflow.manage` — только видимые (#432)                                                                                                                                                                                                                            |
| `POST /workflows/types`                      | `workflow.manage` | Тип + маршрут-основа (копия того же вида или простой); тип рождается скрытым, код — `custom-<hex>`                                                                                                                                                                                                                                                                      |
| `PATCH /workflows/types/:id`                 | `workflow.manage` | Свойства типа; ставит `customizedAt` (каталог не трогает); ответ — DTO типа. «Стандартный»: `creatable:false` — `409 PROCESS_TYPE_SYSTEM_LOCKED` (#432)                                                                                                                                                                                                                 |
| `PATCH /workflows/types/:id/config`          | `workflow.manage` | Настройки типа (#432): `card` (скрытые блоки, подписи ролей), `access` (кто видит / кто создаёт) и `creation` (где создаётся — типы проектов, вид папки, «без проекта», #665) — разделы заменяются ЦЕЛИКОМ, сохраняются сразу, публикации не требуют; событие `workflow.type_updated {fields: ['config.card'…]}`. У писем каталог системный: правится только `creation` |
| `POST /workflows/types/:id/archive\|restore` | `workflow.manage` | Архив/возврат; системный — `409 PROCESS_TYPE_SYSTEM_LOCKED`, имя уникально среди живых (`409 PROCESS_TYPE_NAME_TAKEN`)                                                                                                                                                                                                                                                  |
| `GET /workflows/:id`                         | любой вошедший    | Документ маршрута + версия + счётчики сущностей по статусам                                                                                                                                                                                                                                                                                                             |
| `GET /workflows/stage-names`                 | `workflow.manage` | Имена статусов для подсказок: системный каталог (`code`) + опубликованные маршруты; `routes` — число маршрутов; warning-и имён — только по опубликованным (#430)                                                                                                                                                                                                        |
| `POST /workflows/:id/publish`                | `workflow.manage` | Публикация: `SELECT … FOR UPDATE` → сверка `baseVersion` (`409 WORKFLOW_VERSION_CONFLICT`) → `checkWorkflowDocument` (`422 WORKFLOW_INVALID`) → серверные проверки → план → применение (удаление = архивация) → `version++` + событие `workflow.published`                                                                                                              |
| `PUT /workflows/:id/layout`                  | `workflow.manage` | Расстановка холста без новой версии (слияние по элементам, только живые id), событие `workflow.layout_changed`                                                                                                                                                                                                                                                          |

Мутации — `Idempotency-Key` (ADR-0005) + аудит (`workflow.*`). Чтение схем — решение владельца: типы и маршруты видят все вошедшие.

## Форма создания (#432)

`Workflow.creation` — раздел документа маршрута: `{ fields: [{ key, label, required, preset }], chips: ['checklist'|'planned'] }`, `null` — форма по умолчанию категории (описание, ответственный, срок, проект + чипы). Публикуется версией вместе со стадиями и кнопками: правка только формы поднимает версию, переносов нет. Проверки — `checkCreationForm` (contracts, общая грамматика с вебом) с фактами: привязанные к типу атрибуты (`customFieldFactsOf` с `typeId`), определения области и живые сотрудники в пресетах (`creation-facts.ts`). Копия типа переносит и форму, и привязки атрибутов основы — иначе окна скопированного маршрута стали бы невалидными.

## Публикация и фоновый перенос

`POST /workflows/:id/publish` одной транзакцией считает план (`editor/publish-planner.ts`), применяет (`editor/publish.repository.ts`) и эмитит `workflow.published` с `category`, `moves` и `restates`. Outbox-обработчик `events/workflow-published.handler.ts` ставит BullMQ-задание **`workflows-sync`** (jobId `<workflowId>__v<version>`, attempts 8 + backoff). Задание выбирает адаптер категории и отдаёт ему `migrateStage` / `restateStage` — пачки и транзакции внутри владельца. Идемпотентно: повтор ничего не находит.

## Системный каталог

`catalog/system-catalog.ts` (+ `system-catalog-quick.ts`) — данные, которыми владеет код. `CatalogBootstrap` применяет ревизию, пока сущность не правили руками (`customizedAt IS NULL` и `catalogRevision` меньше текущей): создаёт недостающее, обновляет стадии/переходы по `code`, архивирует живые переходы вне каталога. Настроенное не трогается никогда (лог `catalog.skip_customized`). Применённая ревизия — системная публикация: `version++` и `workflow.published` (пересчёт групп — тем же фоновым заданием). Каталог описывает обе категории — задачи (`system-catalog*.ts`) и письма (`system-catalog-letters.ts`); ревизии задач 5, писем 2 (#430).

## События (`WORKFLOW_EVENTS`)

`workflow.type_created` (с `category`) / `type_updated` (поля — имена свойств и разделов `config.*`) / `type_archived` / `published` (с `category`, `moves`, `restates`) / `layout_changed` — **без audience**: gateway рассылает их всем авторизованным сокетам (комната presence), клиенты инвалидируют каталоги. Прежние `task.type_*` / `task.workflow_*` зарезервированы и не эмитятся (#428); история задач читает старые записи event log.

Подписка на чужие события: `project.type_copied` (#857) — `events/project-type-copied-scope.handler.ts` дописывает копию типа проекта в `config.creation.excludedProjectTypeIds` каждого типа записи (задача и письмо), исключавшего основу, тем же путём, что окно типа (#665: без `customizedAt`, событие `workflow.type_updated {fields:['config.creation']}`); не исключавшие основу не трогаются, повторная доставка — no-op.

## Границы

- Движок не пишет таблицы сущностей и не знает их прав/ролей — только через адаптер.
- Личные маршруты «Моего плана» — не здесь (временное исключение ADR-0024).
- Журнал `transition_records` пишет **движок** в транзакции перехода (адаптеры его не трогают): одна строка на каждый `execute` — кнопка, DnD, «Мой план». Действие без смены статуса (#633) пишет строку `record_kind = action` с `action_id`, `from_stage_id = to_stage_id` (время в статусах не разрывается). Колонки: `entity_kind/entity_id`, `transition_id`, `action_id`, `from_stage_id/to_stage_id` (фактическая цель после `route_if`), актор или правило, `record_kind`, `comment`, `result_id` (ревизия итога, uuid), `fields` (только изменённое окном), `time_entry_id`, `answers` (задел #381). Индекс `(entity_kind, entity_id, created_at DESC)` покрывает историю карточки и «кто сдал работу» (#430).

## Окно перехода (#380)

`WorkflowTransition.form` — часть документа маршрута (ADR-0021): `{ enabled, title?, sections[] }`, разделы закрытого реестра (`fields | time | result | result_files | result_messages | comment`). Публикуется вместе с кнопкой; `GET /workflows/:id` отдаёт форму, DTO кнопки (`WorkflowTransition`) — `form` (null — выключено) и `validators`. `WorkflowTransition.press` — настройка «кнопку жмут несколько» (#434): `sources / quorum / order / excludeAuthor`, публикуется и читается тем же документом; раунд сбора хранит снимок `form`/`config` на старте.

Порядок `execute` (одна транзакция): замок → субъект по состоянию ДО окна → условия «кто» → сверка `form` с эффективным окном (`effectiveWindowSections`: настройка ∪ гейты) → `adapter.applyForm` (поля/время/итог) → субъект ПОСЛЕ окна → гейты и обход → замки исполняемой кнопки → `applyStage` → журнал. Выбор по целевой стадии (DnD/«Мой план») может иметь несколько кандидатов: окно применяется к первой кнопке без обязательного окна, исполняется первая, чьи гейты прошли; если исполняемая кнопка — не та, окно и замки относятся к исполняемой, а заменная кнопка с обязательным окном даёт 422 (жест окно не открывает). Выбор по `transitionId` не переигрывается. Ошибки: 422 `WORKFLOW_TRANSITION_FORM_INVALID` (`details { transitionId, missing[], unexpected[] }`) — лишний/пропущенный обязательный раздел или DnD в кнопку с обязательным окном; 409 `WORKFLOW_TRANSITION_BLOCKED` — гейт после окна. Обязательность содержимого — только гейты (Р3): новый валидатор `result_files { min 1..5 }` считает живые вложения итога (стикеры не считаются).

- **Кастомные атрибуты** (#431, ADR-0029; ревизия #631): ключ `cf.<uuid>` допустим и в разделе `fields` окна, и в гейте `fields_required`. Факты гейта (`WorkflowGateFacts`) несут `customFields` (значения), `activeCustomFieldIds` (весь реестр портала) и `inTypeCustomFieldIds` (привязанные к типу процесса); неизвестный (удалённый) ключ переход не блокирует. Публикация проверяет документ с фактами типа маршрута: неизвестное поле — `custom_field_unknown`, существующее, но не привязанное к типу, — `custom_field_not_in_type`; глобального `hidden` нет (О2 #631). Значения окна приходят вложенной картой `form.fields.customFields.<id>` и пишутся общим писателем владельца.
- **Письма** (категория `letter`, #55): адаптер модуля `correspondence`; каталог сеет типы «Входящее/Исходящее письмо» и заготовки маршрутов (новое → на резолюции; закрытие без регистрации; отмена регистрации), серии «Вх»/«Исх» (`number_series`) и ревизию **на маршрут** (`CatalogWorkflow.revision`: задачи 5, письма 2 — правка писем не поднимает версии задач).
- **Нумерация** (`numbering/`): `NumberSeriesService.next` — низкоуровневая выдача группы `(series_id, scope_key)`: upsert `number_counters` в транзакции перехода, рендер номера из шаблона серии (сегменты counter/literal/year/month/field, `number-template.ts`), первый номер группы — `start_value`; год/месяц — по `COMPANY_TIMEZONE`. Пост-действие `assign_number` в `execute` выдаёт номер до смены стадии (`nextForType` — серия из `config.numbering` типа, ключ группы — период-часть), адаптер получает `meta.numbering`, журнал — `fields.number`. Тип без `config.numbering` и битый шаблон серии — 409 `WORKFLOW_NUMBERING_NOT_CONFIGURED`. Правило серии «разрез × период × шаблон × старт» (#630, Пакет 0: хранилище; заготовки разреза/формула и counter-атрибут — Пакет 2).
- **Замок каталога писем** (`catalog/letter-lock.ts`, Р4): публикация, раскладка, правка типа/конфига, архив и создание типа письма — 409 `PROCESS_TYPE_SYSTEM_LOCKED {reason:'letter_catalog'}` до #463/#464; снятие — по направлению (`LOCKED_LETTER_DIRECTIONS`).
- DTO типа гидрирует `numbering {seriesId, prefix, reset}` пачкой (`seriesRefs`); публикация проверяет `numberingConfigured`.

## Правила v2 (#430)

- **Итог `rejected`** — третий итог закрытой стадии: CHECK `workflow_stages_outcome_values_check` расширен expand-миграцией; уведомление `task.rejected` уходит автору и исполнителю; `isCompletedState` и SQL `done_count` не считают `rejected` выполненной.
- **Смысл кнопки `intent: action | service`** — колонка `workflow_transitions.intent`; умный дефолт `smartIntent` (пауза/итог «Отменена» → service); публикация, копия типа и сид каталога переносят поле; DTO `WorkflowTransition` отдаёт его редактору и будущим «Моим действиям».
- **Пропуск по актору** — `route_if: approver_is_actor`: контекст `engine/approver-context.ts` считает актора утверждающим, если он проходит условия единственной основной action-кнопки целевого статуса без обхода, её гейты выполнены, условие «кто видит» непустое и нет обязательных разделов окна. `creator_is_assignee` остаётся для старых документов.
- **Подсказки имён** — `GET /workflows/stage-names` (`workflow.manage`): имена неархивных стадий системного каталога (по `code`) и опубликованных маршрутов категории с числом маршрутов; подсказки показывают все, warning-и имён включены для пользовательских маршрутов (системные не шумят). В редакторе — комбоподсказки; публикация даёт warning-и `stage_name_shared`/`stage_name_similar`.
- **Проверки публикации** — `workflow-document-extra-checks.ts`: имена, дубли целей (`duplicate_transition_target`), разрешимость `approver_is_actor` (`approver_rule_unresolvable`); `action_without_visibility` — для задач, не для писем. Warnings не блокируют публикацию; сервер отдаёт только 422 при ошибках, live-список показывает веб. Окна кнопок-переходов и действий проверяются одним набором правил (#740): дубли/бесполезные разделы, оформление, замки, удалённые и непривязанные атрибуты, формулы слотов — проблемы несут `transitionId` или `actionId`. Действие публикуется только с содержимым: окно включено, но разделов ноль — `action_window_empty` (пустое окно штамповало записи в журнал); без окна и без шагов — `action_without_form_and_steps`. В окне действия разрешены только разделы, смысл которых определён без смены статуса (`ACTION_FORM_SECTION_KINDS`): «Поля», «Трудозатраты», «Комментарий»; «Регистрация» (номер выдаёт переход) и разделы итога (`result`, `result_files`, `result_messages` — ревизия итога обошла бы гейт `result_present` следующего перехода) дают `action_section_unsupported`. Текст отказа (`message`) собирает `publish-rejection.ts` из i18n контрактов и называет хозяина дефекта («В действии «X» включено окно, но не выбрано ни одного раздела…»), полный перечень — в `details.problems`. Коллективная кнопка (#434) проверяется `workflow-document-press-check.ts`: только задача, непустые источники, роли категории, поле «Сотрудник(и)», одна кнопка на статус, обычная кнопка-действие из конкретного статуса. Публикация с открытыми раундами сбора не меняет и не архивирует их кнопку — read-порт `WORKFLOW_PRESS_ROUNDS_READER` (tasks) отдаёт id, ответ `CONFLICT`: иначе движок при кворуме выполнил бы уже другой переход.

## Серии номеров (#630)

`number_series` / `number_counters` / `number_assignments` — таблицы «Процессов»; модуль атрибутов читает и пишет их только через порт `NUMBER_SERIES_STORE` (`ports/number-series.port.ts`, реализация `numbering/number-series.provider.ts`). Письмо-серии (`config.numbering` типа) живут там же: `nextForType` выдаёт «Вх-ГГГГ/N» без атрибута; счётчики атрибутов — серия 1:1 с определением. Счёт — `(series_id, scope_key)` = значения условий × период; upsert `last_value + step` сериализует параллельные выдачи; откат транзакции не тратит номер.

## Решающие вне задачи (#433)

- `decider_in` — третье условие «кто»: `{ kind: 'decider_in', source }`,
  источники — ближайший руководитель автора/исполнителя, сотрудники, поле
  «Сотрудник(и)», роль в проекте (#806: должность удалена — «любой держатель»
  не равен ответственному). `role_in` и `permission` остаются как были;
  несколько условий — «любой из».
- Единая точка правды — `matchesDecider(source, facts)` в
  `@nodus/contracts` (`workflows/decider.ts`): её используют движок,
  видимость задач и будущая проекция #438.
- Факты актора в контексте задачи собирает адаптер сущности через
  `TaskDeciders` (`WorkflowActorSubject.deciderFacts`); движок БД не знает.
  `targetCtx1` берёт факты из состояния ДО окна: окно не делает актора
  решающим.
- Вакансия перехода (`vacantDeciderTransitionIds`): все источники пусты →
  кнопку видит только `task.override_gate`, в `blockedBy` — `decider_vacant`,
  причина обязательна.
- Read-порт `WORKFLOW_RULES_READER` (`ports/workflow-rules-reader.port.ts`)
  отдаёт живые переходы с `decider_in` (+ `intent`), битую строку правил
  пропускает с warn — чужой маршрут не роняет чтение задач.
- Публикация проверяет источники: поле не user/users (`decider_field_not_user`),
  пустой список сотрудников — ошибка публикации (`decider_source_empty`;
  в уже опубликованном/мигрированном маршруте такой источник = вакансия), письма —
  `decider_not_in_category`, кнопка только для решающих с полями/временем/итогом —
  `decider_window_needs_rights`.
- Должность как источник удалена (#806, ADR-0025): существующие маршруты
  миграцией `20261125130000_remove_position_deciders` переписаны на текущих
  активных держателей (`employees`); архивная должность сохраняет держателей,
  вакантная даёт пустой список. Replay — `scripts/audit/806-migration-replay/`.

## Общая выборка — один вход вычисления (#635)

«Какие записи → условие → сколько» описывается ОДНИМ способом
(`@nodus/contracts` `workflows/condition-query.ts`: субъект → предикаты И →
квантор all/any/none), и вычисляется в ОДНОМ месте —
`workflow/conditions/` (unified-model §7 «Одна выборка на всё»).
Проверки и условия кнопок (#635) работают сейчас; условия шагов (#634),
правила и ветки (#448, #38), показатели папки (#865) и расширенный фильтр
списков (#435) подключаются к ЭТОМУ входу и своего языка не заводят.

- **Что входит**: `ConditionEvaluator` (`evaluator.service.ts`) — рантайм на
  один вызов движка (кэш выборок/стадий/определений); чистая логика
  предикатов и кванторов — `condition-logic.ts` (unit-тестируется без БД);
  политика обхода — `override-policy.ts`. Множества записей читает порт
  `CONDITION_RECORDS_READER` (`custom-fields/ports/condition-records.port.ts`):
  композиция портов владельцев (tasks/correspondence/projects) мапит субъекты
  на выборки (`folder_type_tasks` досчитывается папками проекта → задачи
  папок), `project_tasks` — расширенный метод владельцев. Формулы (kind
  formula) — существующий `FORMULA_CELLS.evaluate` (истина = проходит).
- **Кто вызывает**: `WorkflowEngine` — условия `records`/`formula` в
  `canShow` ДО окна (кнопка с ложным условием скрыта, в обход интерфейса —
  те же проверки); причины валидаторов — ПОСЛЕ окна по живым данным
  (`blockedBy` в DTO до нажатия, 409 `WORKFLOW_TRANSITION_BLOCKED`
  `details.reasons` при нажатии). Предвычисление —
  `engine/gate-runtime.ts` (`precomputeGates`): без новых видов правил —
  ни одного запроса.
- **Два закона выборки**: квантор честный — полная выборка считает ВСЕ живые
  записи, включая невидимые актору (мягко удалённые исключены всегда);
  видимость одна — причина называет только видимые нажавшему записи (до 5 +
  `hiddenCount` «и ещё N без доступа»), фильтр — та же функция видимости,
  что у списков (порты владельцев `visibleTaskIds`/`visibleLetterIds`/
  `refsFor`).
- **Предикаты**: `type_is` (живой тип), `field` (операторы eq/ne/gt/gte/lt/
  lte/contains/not_contains/in_any/filled/not_filled; совместимость с типом
  атрибута — матрица `CONDITION_FIELD_OPS_BY_TYPE` в contracts), `stage_is`
  (стадия маршрута типа записи), `system_state`, `outcome`, `result_issued`
  («результат выдан»: стадия записи отмечена в маршруте её типа; нет отметок
  в маршруте — выдана = закрыта успешно). Отметка — колонка
  `workflow_stages.result_issued` (expand-миграция
  `20261127132111_workflow_stage_result_issued`), пишется публикацией и
  читается документом/копией типа.
- **Обход**: политика каждой непройденной проверки (`gateOverridePolicy`):
  `forbidden` — не пускает никого (403 `WORKFLOW_GATE_OVERRIDE_FORBIDDEN`);
  `default` — руководство проекта записи (руководитель/помощники — факты
  `WorkflowActorSubject.projectRoles` собирают адаптеры) ∪ `task.override_gate`
  ∪ доп. сотрудники ∪ роль в проекте. Причина обязательна всегда;
  `overriddenGates`+`overrideReason` едут в историю (`stage_changed` meta и
  `transition_records`).
- **Как добавлять субъекты**: расширить `conditionSubjectSchema` и
  `CONDITION_SUBJECTS_BY_CATEGORY` (contracts) → метод чтения у
  владельца данных (порт) → маппинг субъекта в
  `custom-fields/ports/condition-records.provider.ts` → предикаты не трогать
  (они по записи, не по субъекту). Новые предикаты — в
  `condition-logic.ts` + матрица операторов + проверки публикации
  (`workflow-document-condition-check.ts`, факты — `editor/condition-facts.ts`).
- **Публикация**: чистые проверки `workflow-document-condition-check.ts`
  (субъект вне категории, удалённые тип/стадия/вид папки/атрибут, stage_is
  без type_is, несовместимый оператор — ошибки; `project_tasks`/
  `folder_type_tasks` без фильтра — предупреждение `condition_query_unfiltered`);
  АСТ формул-условий проверяет движок формул (`workflow-formula-checks.ts`,
  результат обязан быть bool).
