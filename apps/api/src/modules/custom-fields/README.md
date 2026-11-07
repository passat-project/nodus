# Модуль custom-fields (ядро)

Реестр **атрибутов** портала (M10, ADR-0029 + дополнение #631): одно определение на весь портал — много мест использования. В интерфейсе термин «Атрибуты»; в коде и API — `custom field` / `customFields`: ключи таблиц и контрактов не переименовываются.

Модуль ядра без feature flag (modules.md): атрибуты нужны карточкам, фильтрам и окнам переходов задач, а те уже под флагом `tasks`.

## Что здесь, а что — нет

- **Здесь:** определения (тип, настройки, умолчание, номер, порядок), их CRUD, привязки «Где используется» (`field_bindings`: типы задач/писем, типы проектов, виды папок), глобальные переменные (`company_values`), порт `CUSTOM_FIELD_REGISTRY` для модулей-владельцев сущностей.
- **Не здесь:** значения. Они живут в JSONB-колонке сущности-владельца (`tasks.custom_fields`, `letters`, `projects`, `project_nodes`, `counterparties`) по id определения. Чужих таблиц модуль не читает и не пишет (I3): «сколько записей заполнено» и уборку значений после удаления выполняет владелец — через порты `CUSTOM_FIELD_VALUES_READER` (задачи), `LETTER_FIELD_VALUES_READER` (письма), `COUNTERPARTY_FIELD_VALUES_READER` (контрагенты), `PROJECT_FIELD_USAGE_READER` (проекты/папки) и обработчики события `custom_field.definition_changed` (`change='deleted'`, безусловно — каждый чистит свою таблицу, идемпотентно).

## Модель (#631)

- **Одно определение на портал**: имени уникально глобально (`lower(btrim(name))`, выраженный уникальный индекс; проверка под `pg_advisory_xact_lock(431, 0)`); областей `scope` и глобального `hidden` больше нет — видимость регулирует слот формы места (О2). Дубль имени — 409 `CUSTOM_FIELD_NAME_TAKEN` с `details.suggestion {definitionId, name}` («открыть существующий»).
- **Номер** `number Int @unique` — внутренний адрес атрибута (формулы #632), выдаётся из sequence `field_definitions_number_seq`, не переиспользуется, в интерфейсе не показывается. Ключи значений и `cf.<id>` в маршрутах остаются UUID (О1).
- **Привязки** `field_bindings (definition, target_kind, target_id)`: `process_type` (живой, задачи и письма любых категорий), `project_type` (включая архивные), `node_kind` (включая архивные — формы архивных видов живут). Слот формы вида/типа — та же привязка: запись формы добавляет привязку нового слота и снимает только снятый слот (`syncPlaceBindings`), пикер «Где используется» пишет ту же таблицу точечными PUT/DELETE. Привязка без слота законна — миграция сеет системные поля на все места, диалог привязывает без слота; запись формы такие привязки не сносит (#646).
- **Глобальные переменные** `isCompany`: привязок и значений у записей не имеют (422), значение — одна строка `company_values` (PK = определение), грамматика — тип определения; чтение — всем аутентифицированным в DTO (`companyValue`), запись — `custom_field.manage` (PUT `…/company-value`, null — очистить; событие `fields:['companyValue']`).
- **Удаление всегда разрешено** (В4): окно последствий показывает usage-агрегат `{values{task,letter,counterparty,project,node}, forms, workflows, bindings, companyValue}`. `forms` — слоты в формах создания процессов (включая непубликуемые черновики, `draft: true`), формах типов проектов и видах папок; значения считаются по всем записям, включая мягко удалённые (уборка стирает и их). Опубликованные маршруты с `cf.<id>` продолжают работать (толерантность unknown-ключа), повторная публикация — `custom_field_unknown`. Значения контрагентов считает и чистит crm через свои порт/обработчик (#646) — колонка `counterparties.custom_fields` переписывается миграцией #631, хотя пути записи появятся в Н2.
- Потолок портала 1000 (`CUSTOM_FIELD_LIMITS.portal`, техническая страховка, Р12); продуктового лимита нет (В7).

## Типы (19 в 13 семействах интерфейса)

`text` · `long_text` · `number` (точность 0–6) · `money` (сумма + валюта системного справочника `currency`) · `date` · `datetime` · `duration` (минуты, показ «ч:мм») · `bool` · `enum` · `multienum` (справочник `dictionaries`, варианты с цветами — Р6) · `user` · `users` · `department` · `project` · `counterparty` (порт CRM) · **`task` · `letter` · `node`** (ссылки на записи, Р5) · `link` (URL `http(s)://` или путь `\\сервер\…`).

Смена типа — только расширяющая: `text → long_text`, `enum → multienum`, `user → users` (409 `CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE`). Скаляр читается как массив (`readCustomFieldValue`), данные не переписываются.

Ссылки-записи (`task`/`letter`/`node`) проверяются на видимость актёру через порты владельцев: `TASK_REF_READER` (существует, не удалена; конфиденциальная — участник), `LETTER_REF_READER` (круг доступа #461), `NODE_REF_READER` (проект узла видим актёру). Скрытая цель = несуществующая (без оракула секретности). Читатель без доступа видит имя `null` («нет доступа»), удалённая цель — `name: null, archived: true` («запись удалена», значение не инвалидируется).

## Порт реестра (ADR-0012)

```ts
CUSTOM_FIELD_REGISTRY: CustomFieldRegistry {
  definitions({ target? }, tx?)                       // target {kind: process_type|project_type|node_kind, id} — место сущности; без — весь реестр
  prepareCreate({ input, authorId, actor, target? }, tx?)   // умолчания + ввод (ввод важнее) + проверка
  prepareUpdate({ current, patch, actor, target? }, tx?)    // null удаляет ключ; запись вне места — not_in_type
  refs(values, actor, tx?) / refsMany(valuesList, actor, tx?)  // имена/аватары/архивность/цвета для DTO
  syncPlaceBindings(target, fieldIds, tx?)            // слот формы места = привязка (project_type|node_kind)
}
```

Владелец сущности не собирает zod-схемы и не ходит в справочники сам: единственная точка динамической валидации — порт (I7). Отказ — `422 CUSTOM_FIELD_VALUE_INVALID` с `details.issues[] = {fieldId, reason: unknown|invalid|not_found|inactive|not_in_type, message}`. Со `target` порт работает только с привязанными к месту определениями: умолчания не «протекают» в чужое место, запись значения непривязанного атрибута отвергается `not_in_type` (очистка `null` разрешена всегда), неизвестный ключ остаётся `unknown`.

Ссылки проверяются пачками через порты владельцев данных: `USER_PROFILE_READER`, `ORG_STRUCTURE_READER`, `DICTIONARY_READER`, `COUNTERPARTY_READER`, `PROJECT_READER`, `TASK_REF_READER`, `LETTER_REF_READER`, `NODE_REF_READER`. Умолчание со ссылкой, ставшей неактивной, тихо пропускается с warn в лог — создание сущности не ломается.

## Системные поля (Р9)

`SYSTEM_FIELD_IDS` (contracts, uuidv5 — одинаковые id во всех средах): `projectCode` «Шифр» (text), `projectClient` «Заказчик» (counterparty), `nodeCode` «Код» (text). Сеются миграцией 20261111000000 с поглощением одноимённых того же типа и переносом значений из колонок `projects.code/client_id`, `project_nodes.code`; колонки заморожены (не читаются, удаляются отдельным chore). События `project.created/updated` несут `code/clientId` как производные из `customFields`. Посевные — обычные атрибуты: администратор может удалить их (окно покажет последствия).

## Эндпоинты (`/api/v1/custom-fields`)

| Маршрут                                            | Права                 | Назначение                                                                                                                                |
| -------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /definitions?module=`                         | auth                  | Реестр портала (массив, без курсора — О9: потолок 1000); `module`: task/letter (привязка к живому типу категории), project, node, company |
| `POST /definitions`                                | `custom_field.manage` | 201; 409 дубль имени (с suggestion)/потолок; 422 недоступная цель привязки; `bindings` сразу                                              |
| `PUT /definitions/order`                           | `custom_field.manage` | `ids` = ровно все атрибуты портала, иначе 409 `CONFLICT`                                                                                  |
| `GET /definitions/:id/usage`                       | `custom_field.manage` | Агрегат последствий удаления (Р8)                                                                                                         |
| `PUT /definitions/:id/bindings/:kind/:targetId`    | `custom_field.manage` | Привязка (kind: process-type/project-type/node-kind), идемпотентна; 404 неизвестная цель, 422 архивный тип процесса                       |
| `DELETE /definitions/:id/bindings/:kind/:targetId` | `custom_field.manage` | Снятие привязки — всегда разрешено (О3), идемпотентно                                                                                     |
| `PUT /definitions/:id/company-value`               | `custom_field.manage` | Значение глобальной (null — очистить); не-глобальному — 422                                                                               |
| `PATCH /definitions/:id`                           | `custom_field.manage` | 200; 409 тип/имя; 422 форма настроек; `bindings` — замена целиком                                                                         |
| `DELETE /definitions/:id`                          | `custom_field.manage` | 204 всегда (В4); значения стирают владельцы по событию                                                                                    |

Правила: `sortOrder = max+1` при создании; `reorder` — по всем атрибутам портала; порядок выдачи `(sort_order, id)`.

## События (outbox, I9)

`custom_field.definition_changed {definitionId, change: created|updated|deleted|reordered, fields?}` — каталожное (gateway рассылает в presence-комнату): клиенты инвалидируют реестр, блок «Атрибуты» карточек и подписи вариантов. `fields` содержит `bindings`/`companyValue` при их изменении.

Значение атрибута в отдельном событии не ездит: изменение — в событии сущности (`task.updated` / `project.node_updated` c `customFieldChanges[{fieldId, from, to}]`, ≤ 50, `long_text` обрезан до 500, ключи `cf.<id>` в `fields`).

**Уборка значений удалённого атрибута**: обработчики-владельцы — `CustomFieldValuesCleanupHandler` (задачи), `LetterFieldValuesCleanupHandler` (письма), `CounterpartyFieldValuesCleanupHandler` (контрагенты, #646), `ProjectFieldValuesCleanupHandler` (проекты и папки; дополнительно убирает слоты из форм типов проектов и видов папок и эмитит `project.type_changed` / `project.node_kind_changed`). Все чистят безусловно по `definitionId` (без областей, идемпотентно). Имена классов обработчиков уникальны: диспетчер различает их по имени класса (gotcha backend.md).

## Умолчания (Р5)

`{kind:'static', value}` или `{kind:'author_department'}` (только тип `department`). Подставляются при создании сущности на всех путях создания; явное значение важнее. «Подразделение автора» — снимок на момент создания, при переводе сотрудника не пересчитывается. Умолчания-ссылки на записи (`project`/`task`/`letter`/`node`) не принимаются: у умолчаний нет актёра видимости.

## Известные ограничения

- `reportIndexed` только запоминается: материализация — по триггеру (Н4). DDL из рантайма не делаем (дрейф схемы, права на DDL).
- Цвета вариантов (`dictionary_items.color`) красят чипы значений; раскраска строк/ячеек видов — #435/#636.
- Фильтры по значениям — клиентские (Р8): серверный `filter[cf.<id>]` — #435; у писем/проектов фильтров атрибутов пока нет (N1, #435).
- Формулы (#632) читают глобальные значения и карту номер→id реестра; «переменные, меняемые кнопками» — #634.
- Инвариант формульной ячейки (#660, 07.11): если у атрибута есть формула — своя (`formula_cells`) или привязки (`field_bindings.default_formula`) — значение пишет только она. Ручная запись — 422 `FORMULA_CELL_LOCKED` (порт `lockedFieldIds`); реестр нормализует дефис-маркер «пусто» (—, –, ‐…) в null при записи; формулы привязок сохраняются и телом `bindingFormulas` POST/PATCH определений (`FormulaBindingService.applyWithinTx`).
- «Строка реестра» как тип значения и `registry_kind` в привязках — #636.
- **Путь-ссылка (`link`) проверяется только грамматикой**: значение не передаётся ни в shell, ни в `explorer.exe` — в вебе путь копируется строкой. Когда появится «Открыть в проводнике» (Н3), мост обязан экранировать путь и запрещать запуск `.exe`/`.lnk`: регэксп значения допускает в хвосте пути любые непробельные символы (кавычки, `&`, `%`, `..`) — это нормальный UNC, но не аргумент командной строки.
