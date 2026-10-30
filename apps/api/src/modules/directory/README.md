# Модуль directory (ядро)

Пользователи, отделы (дерево оргструктуры), должности, роли; карточка сотрудника.
Модель — эпик M2 (#18), требования владельца:

- **Гибкие связи**: `managerId` у сотрудника — подчинённость в пределах группы (ГИП ↔ помощник) без фиктивных отделов.
- **Двойная структура**: управленческая (`kind=management`) и юридическая (`kind=legal`) пары должность/подразделение — первоклассные справочники (I15), не кастомные поля.
- **Руководитель и заместитель** у подразделения (`headId`, `deputyId`) — задел под переадресацию при отсутствиях (модуль замещения — позже, схема готова).
- **Расширяемость профиля**: ядро карточки стабильно; кастомные поля — модуль custom-fields (M10), геймификация/HR — отдельные модули по `user_id`.

## Контракты (`@nodus/contracts`)

`userCardSchema`, `userListItemSchema`, `listUsersQuerySchema`, `createUserSchema`, `updateUserSchema`, `updateMyProfileSchema`; `departmentNodeSchema`, `createDepartmentSchema`, `updateDepartmentSchema`; `positionSchema`, `createPositionSchema`, `updatePositionSchema`; `roleSchema` (со счётчиками состава и `preview`), `createRoleSchema`, `updateRoleSchema`, `roleMembersSchema`, `SystemRole`.

## Эндпоинты (`/api/v1/directory`)

| Маршрут                                                           | Права              | Назначение                                              |
| ----------------------------------------------------------------- | ------------------ | ------------------------------------------------------- |
| `GET /users`                                                      | directory.read     | Список: `?cursor=&limit=&search=&departmentId=&status=` |
| `GET /users/:id`                                                  | directory.read     | Карточка сотрудника                                     |
| `PATCH /users/me`                                                 | auth               | Саморедактирование контактного блока                    |
| `POST/DELETE /users/me/avatar`                                    | auth               | Аватар СВОЕГО профиля: multipart → WebP-дериват (#186)  |
| `POST /users`, `PATCH /users/:id`, `POST /users/:id/deactivate`   | directory.manage   | Управление сотрудниками                                 |
| `GET /departments/tree?kind=`                                     | directory.read     | Дерево оргструктуры (head/deputy/memberCount)           |
| `POST/PATCH /departments/:id`, `POST /:id/archive`                | directory.manage   | Управление деревом (защита от циклов)                   |
| `GET /positions?kind=`, `POST`, `PATCH /:id`, `POST /:id/archive` | read / manage      | Справочник должностей                                   |
| `GET /roles`, `POST`, `PATCH /:id`, `DELETE /:id`                 | read / role.manage | Роли и состав прав                                      |
| `PUT/DELETE /roles/:id/permissions/:permission`                   | role.manage        | Точечная выдача/отзыв права (#379, идемпотентно)        |
| `GET /roles/:id/members`                                          | directory.read     | Состав роли: сотрудники и подразделения                 |
| `PUT/DELETE /roles/:id/members/users/:userId`                     | role.manage        | Добавить/убрать сотрудника (#379)                       |
| `PUT/DELETE /roles/:id/members/departments/:departmentId`         | role.manage        | Привязать/отвязать подразделение (#379)                 |

## События (outbox, I9)

Все имена — из `DIRECTORY_EVENTS` контрактов (литералов в коде нет): `directory.user.created` / `directory.user.updated` (payload: userId, changedFields) / `directory.user.deactivated` (payload: userId — auth отзывает сессии); `directory.department.created` / `updated` / `archived`; `directory.position.created` / `updated` / `archived`; `directory.role.created` / `updated` (только `name`/`description`) / `deleted`; `directory.role.permissions_changed` `{roleId, permission, granted}` — по событию на реально изменённое право; `directory.role.members_changed` `{roleId, kind, targetId, added}` — при реальном изменении состава. Gateway эти события пока не маршрутизирует (подписчиков у клиентов нет — #382).

## Правила

- Создание сотрудника — только администратором (self-registration нет); начальный пароль — Argon2id через core `PasswordService`.
- Email уникален **без учёта регистра** (#321): контракт входа (`emailInputSchema`) приводит адрес к `trim + lower`, БД хранит только нормализованную форму (CHECK `users_email_normalized`), поэтому обычный unique `users.email` регистронезависим; предпроверка → `DIRECTORY_EMAIL_TAKEN` (409).
- **Частичная правка — только присланные поля** (#492): `updateDepartmentSchema`/`updatePositionSchema` — явные `optional()`-поля без значений по умолчанию (Zod 4 подставляет `.default()` и в необязательные поля, из-за чего `PATCH { name }` затирал родителя, руководителя, вида и порядка). Пустое тело → `400 VALIDATION_FAILED`; `changedFields` события — реально присланные ключи. Страж — `packages/contracts/src/update-schemas.guard.test.ts` (все схемы правки).
- **Перенос подразделения сериализуется локом дерева** (#544): смена `parentId` и проверка цикла идут в одной транзакции под `pg_advisory_xact_lock(hashtext('nodus:departments:tree'))`; построчный `FOR UPDATE` лочит разные строки и не мешает двум встречным переносам образовать цикл. Тот же приём, что в дереве задач (`TasksRepository.lockTree`); `findParentChain` читает через `tx`.
- Архивация вместо удаления: пользователи (status), отделы и должности (isActive), роли — удаляются только несистемные и неназначенные.
- Роли — данные, не код: права из каталога `Permission` контрактов. Права сотрудника считает порт `ROLE_MEMBERSHIP_READER` (прямые роли ∪ роли управленческого подразделения и всех его предков) — единственный источник для входа, refresh и `/auth/me` (#379, ADR-0034).
- **«Администратор» неизменяем**: `PUT/DELETE …/permissions` и `PATCH` с `permissions` → `409 ROLE_LOCKED`; имя и описание менять можно. Состав роли `admin` — только конкретные сотрудники: подразделение → `409 ROLE_LOCKED` (`details.reason = 'departments'`).
- **Защита от эскалации (bind/escalate)**: выдать право или назначить роль (сотруднику, подразделению) можно, только если у актора есть все её права → `403 ROLE_PERMISSION_NOT_HELD` (`details.permissions` — недостающие). Правило покрывает все пути смены ролей сотрудника (#490): `roleIds` в `POST/PATCH /users`, перевод в подразделение с привязанной ролью, перенос подразделения — добавленные роли считает порт `ROLE_MEMBERSHIP_READER` снимком «до/после» внутри транзакции. Отзыв права и удаление из роли по правам не ограничены.
- **Последний администратор**: действие, после которого у роли `admin` не остаётся активных прямых участников → `409 ROLE_LAST_ADMIN` (замок строки роли сериализует параллельные правки): удаление из состава (`DELETE /roles/:id/members/users/:userId`), `PATCH /users/:id` с `roleIds` без admin, деактивация последнего участника (#490).
- **Удаление роли**: системная → `409 CONFLICT`. Пользовательская удаляется вместе с составом: назначения сотрудникам и привязки подразделений снимаются каскадом (`ON DELETE CASCADE`), люди просто теряют роль — это и есть смысл удаления (решение владельца 26.10; запрет «сначала уберите всех» убран как лишний шаг).
- **Порядок и форма**: `GET /roles` — `isSystem desc, createdAt asc, id asc`, права по алфавиту, счётчики — активные прямые участники и активные подразделения, `preview` — до 4 аватаров. Права вне каталога отфильтровываются: ответ всегда соответствует схеме.
- **Идемпотентность и сериализация**: каждая мутация — `Idempotency-Key` (core-интерсептор); строка роли берётся `SELECT … FOR UPDATE`, поэтому правки прав, состава и удаление одной роли не теряются при параллельных запросах. Аудит — на каждый вызов (`directory.role.permission_grant|permission_revoke|member_add|member_remove`).
- **Подразделения в ролях**: `department_roles` (expand-миграция). Роль, привязанная к управленческому подразделению, действует на его сотрудников и сотрудников всех вложенных; юридическая структура не участвует, архивная привязка прав не даёт. Переключателя «только сам отдел» нет — исключения решаются назначением людей.

## Лимиты

- Список пользователей — курсорная пагинация ≤ 100 (по умолчанию 50), поиск по ФИО/email.
- Дерево отделов — целиком (десятки узлов; ленивые уровни — при росте > 1000).
- Замещение (временный зам с периодом) и календарь отсутствий — отдельный issue эпика M2; таблица замещений появится там.

## Документация (OpenAPI, I2)

Контроллеры аннотированы для генерации спеки из кода (ADR-0006): схемы — те же контракты
(`userCardSchema`, `paginatedSchema(userListItemSchema)`, `departmentNodeSchema`, …),
`@ApiBearerAuth` на контроллерах, ошибки — `@ApiErrors`, мутации — `@ApiIdempotencyKey`.
