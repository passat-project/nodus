/**
 * Данные RBAC-инвентаризации (I8, #320, #334): причины осознанных исключений
 * — маршруты без права и публичные. Тест-сканер — rbac-inventory.test.ts;
 * реестр только растёт: убранный маршрут валит тест «списки не протухают».
 */
const SELF = 'субъект — сам пользователь (свой аккаунт, профиль, настройки, уведомления)';
const CHAT_MEMBERSHIP = 'членство и роль в беседе — матрица прав в сервисе чата';
const OWN_FAVORITES = 'своё «Избранное» — только записи текущего пользователя';
const STICKER_OWNER = 'владелец личного пака; корпоративный — право sticker.manage в сервисе';
const TASK_ACCESS = 'участие в задаче — политика доступа задач в сервисе (по задаче)';
const PERSONAL_PLAN = 'личная схема «Моего плана» — только свои стадии';
const CATALOG = 'общий справочник/каталог для всех сотрудников, без персональных данных (I15)';
const COUNTERPARTIES =
  'общий справочник контрагентов: на него ссылаются письма и проекты, читают все сотрудники; ' +
  'карточка отдаёт контакты ВНЕШНИХ лиц (ФИО/телефон/почта) — осознанное решение ADR-0033; ' +
  'мутации — crm.create/crm.manage';
const CUSTOM_FIELDS =
  'реестр определений атрибутов — общий каталог без персональных данных: нужен карточкам, ' +
  'фильтрам и окнам переходов каждому сотруднику; мутации — custom_field.manage (#431)';
const VISIBLE_STICKERS = 'видимые паки: корпоративные + свои/установленные (фильтр в сервисе)';
const TASK_VISIBILITY =
  'фильтр видимости задач в сервисе (участие, подчинённые по оргструктуре, task.view_all)';
const TASK_VISIBLE_ONE =
  'видимость задачи (visibleRow: участие, оргструктура, task.view_all), чужая — 404';
const TASK_STAGES = 'каталог стадий + счётчики по фильтру видимости задач';
const LETTER_VISIBILITY =
  'видимость писем в сервисе (Р7): зарегистрированное — всем, незарегистрированное — ' +
  'только correspondence.register; box=new без права — 403';
const LETTER_VISIBLE_ONE =
  'видимость письма (visibleRow, Р7) + условия кнопки в движке; невидимое — 404';
const LETTER_RESOLVERS =
  'адресаты «Принимают решения» — ФИО и аватар активных сотрудников (справочник), ' +
  'нужен форме регистрации письма';
const LETTER_CHAT =
  'членство в беседе письма — адресат или участник (порт LETTER_CHAT_READER), иначе 404';
const STICKER_BY_ID =
  'любой неудалённый пак по id — раздача «из чата»; личные паки не секретны (осознанно, findPack)';
const DIRECT_CHAT =
  'find-or-create личной беседы с сотрудником (канон мессенджера): новая — только с действующим, существующая — и с уволенным (история), #343';
const FILE_ACCESS = 'доступ к файлу — resolveAccess (владелец или участник беседы вложения)';
const PROJECTS_CATALOG =
  'общие справочники модуля проектов (типы, портфели) без персональных данных: нужны журналу, фильтрам и окну создания каждому; мутации — project.setup.manage / project.manage (#52)';
const PROJECT_VISIBILITY =
  'фильтр видимости проектов в сервисе (открытые всем, секретные — участию и project.view_secret), невидимый — 404 (#52)';
const PROJECT_MANAGE =
  'права на проект в сервисе: поля/статусы — руководство проекта (руководитель и помощники) или project.manage; состав — только секретного; передача — действующий руководитель (#52)';
const PROJECT_MEMBERSHIP =
  'участие в проекте в сервисе: состав виден участникам, «Присоединиться» — не-участнику открытого, ручной состав — руководству секретного (#52)';
const PROJECT_STRUCTURE =
  'дерево проекта (#467): чтение — видимость проекта (как карточка), мутации узлов — руководство проекта или project.manage в сервисе (архив — заморозка 400)';
const HOME =
  'витрина Главной: число сотрудников и ближайшие дни рождения (день и месяц, без года — решение владельца #342) — любому вошедшему';

export const INTENTIONALLY_WITHOUT_PERMISSION: Record<string, string> = {
  // Чтение (#334)
  'GET /projects': PROJECT_VISIBILITY,
  'GET /projects/:id': PROJECT_VISIBILITY,
  'GET /projects/:id/history': PROJECT_VISIBILITY,
  'GET /projects/types': PROJECTS_CATALOG,
  'GET /projects/groups': PROJECTS_CATALOG,
  'GET /projects/node-kinds': PROJECTS_CATALOG,
  'GET /projects/:id/members': PROJECT_MEMBERSHIP,
  // Действия с проверкой в сервисе (#52)
  'PATCH /projects/:id': PROJECT_MANAGE,
  'POST /projects/:id/status': PROJECT_MANAGE,
  'POST /projects/:id/transfer': PROJECT_MANAGE,
  'POST /projects/:id/members': PROJECT_MEMBERSHIP,
  'DELETE /projects/:id/members/:userId': PROJECT_MEMBERSHIP,
  'POST /projects/:id/join': PROJECT_MEMBERSHIP,
  'POST /projects/:id/leave': PROJECT_MEMBERSHIP,
  // Дерево проекта (#467)
  'GET /projects/:id/structure': PROJECT_STRUCTURE,
  // Формулы ячеек атрибутов (#632): чтение — видимость проекта/папки,
  // мутации — право правки записи в сервисе (структура/карточка).
  'GET /projects/:id/custom-fields/:fieldId/formula': PROJECT_VISIBILITY,
  'PUT /projects/:id/custom-fields/:fieldId/formula': PROJECT_MANAGE,
  'DELETE /projects/:id/custom-fields/:fieldId/formula': PROJECT_MANAGE,
  'GET /projects/:id/nodes/:nodeId/custom-fields/:fieldId/formula': PROJECT_STRUCTURE,
  'PUT /projects/:id/nodes/:nodeId/custom-fields/:fieldId/formula': PROJECT_STRUCTURE,
  'DELETE /projects/:id/nodes/:nodeId/custom-fields/:fieldId/formula': PROJECT_STRUCTURE,
  'POST /projects/:id/nodes': PROJECT_STRUCTURE,
  'POST /projects/:id/nodes/batch': PROJECT_STRUCTURE,
  'PATCH /projects/:id/nodes/:nodeId': PROJECT_STRUCTURE,
  'POST /projects/:id/nodes/:nodeId/move': PROJECT_STRUCTURE,
  'POST /projects/:id/nodes/:nodeId/move-preview': PROJECT_STRUCTURE,
  'DELETE /projects/:id/nodes/:nodeId': PROJECT_STRUCTURE,
  'GET /auth/me': SELF,
  'GET /auth/sessions': SELF,
  // Личные настройки (#745): субъект — сам сотрудник, userId только из
  // access-токена; чужой профиль недоступен (IDOR).
  'GET /me/preferences': SELF,
  'PUT /me/preferences': SELF,
  'GET /notifications': SELF,
  'GET /notifications/summary': SELF,
  'GET /notifications/settings': SELF,
  'GET /notifications/:id/deliveries': SELF,
  'GET /tasks/timer': SELF,
  'GET /workflows/:id':
    'схема маршрута без персональных данных — решение владельца: типы и схемы видят все (#378, #428)',
  'GET /chat/conversations': CHAT_MEMBERSHIP,
  'GET /chat/conversations/unread-summary':
    'сводка непрочитанных ТОЛЬКО своих бесед — та же граница членства, что у списка',
  'POST /chat/conversations/direct/:userId': DIRECT_CHAT,
  'GET /chat/conversations/:id/members': CHAT_MEMBERSHIP,
  'GET /chat/conversations/:id/messages': CHAT_MEMBERSHIP,
  'GET /chat/conversations/:id/messages/lookup': CHAT_MEMBERSHIP,
  'GET /chat/conversations/:id/pins': CHAT_MEMBERSHIP,
  'GET /chat/conversations/:id/threads/state': CHAT_MEMBERSHIP,
  'GET /chat/conversations/:id/attachments': CHAT_MEMBERSHIP,
  'GET /chat/conversations/:id/attachments/counts': CHAT_MEMBERSHIP,
  'GET /chat/conversations/by-task/:taskId': TASK_ACCESS,
  // Канал проекта (#52, Р8): доступ проверяет сервис (участие в проекте),
  // не RBAC-право.
  'GET /chat/conversations/by-project/:projectId': TASK_ACCESS,
  'GET /chat/conversations/by-letter/:letterId': LETTER_CHAT,
  'GET /letters': LETTER_VISIBILITY,
  'GET /letters/resolvers': LETTER_RESOLVERS,
  'GET /letters/:id': LETTER_VISIBLE_ONE,
  // Формулы ячеек атрибутов письма (#632): чтение — видимость письма,
  // мутации — canEdit письма в сервисе.
  'GET /letters/:id/custom-fields/:fieldId/formula': LETTER_VISIBLE_ONE,
  'PUT /letters/:id/custom-fields/:fieldId/formula': LETTER_VISIBLE_ONE,
  'DELETE /letters/:id/custom-fields/:fieldId/formula': LETTER_VISIBLE_ONE,
  'POST /letters/:id/view': LETTER_VISIBLE_ONE,
  'POST /letters/:id/join': LETTER_VISIBLE_ONE,
  'GET /letters/:id/transitions': LETTER_VISIBLE_ONE,
  'POST /letters/:id/transitions/:transitionId': LETTER_VISIBLE_ONE,
  'GET /letters/:id/history': LETTER_VISIBLE_ONE,
  // Дерево «ёлочки» (#461, Р2): видимость письма в сервисе, невидимый корень —
  // 404 без оракула; дочерние узлы фильтруются той же функцией.
  'GET /letters/:id/tree': LETTER_VISIBLE_ONE,
  'GET /chat/favorites': OWN_FAVORITES,
  'GET /chat/favorites/labels': OWN_FAVORITES,
  'GET /chat/favorites/sources': OWN_FAVORITES,
  'GET /chat/stickers/packs': VISIBLE_STICKERS,
  'GET /chat/stickers/packs/:id': STICKER_BY_ID,
  'GET /chat/urgent/policy': SELF,
  'GET /dictionaries': CATALOG,
  'GET /counterparties': COUNTERPARTIES,
  'GET /counterparties/similar': COUNTERPARTIES,
  'GET /counterparties/:id': COUNTERPARTIES,
  'GET /dictionaries/:code/items': CATALOG,
  'GET /custom-fields/definitions': CUSTOM_FIELDS,
  // Номера записи (#630): видимость записи проверяет реестр носителей —
  // отдельного права нет, иначе наблюдатель без custom_field.manage не
  // увидит номер своей задачи.
  'GET /custom-fields/numbering/host/:kind/:id':
    'номера записи видны тем, кто видит саму запись (проверка в сервисе)',
  'GET /files/:id/office-session': FILE_ACCESS,
  'GET /files/:id/versions': FILE_ACCESS,
  'GET /home/summary': HOME,
  'GET /tasks': TASK_VISIBILITY,
  'GET /tasks/stages': TASK_STAGES,
  'GET /workflows/types': CATALOG,
  'GET /tasks/:id': TASK_VISIBLE_ONE,
  'GET /tasks/:id/branch': `${TASK_VISIBLE_ONE}; маскировка невидимых узлов ветки — #343`,
  'GET /tasks/:id/relations': TASK_VISIBLE_ONE,
  'GET /tasks/:id/results': TASK_VISIBLE_ONE,
  'GET /tasks/:id/history': TASK_VISIBLE_ONE,
  'GET /tasks/:id/time-entries': TASK_VISIBLE_ONE,
  'GET /tasks/:id/transitions': TASK_VISIBLE_ONE,
  // Формулы ячеек атрибутов (#632): чтение — зрителю задачи, мутации и
  // dry-run переноса — праву правки задачи (canEdit) в сервисе.
  'GET /tasks/:id/custom-fields/:fieldId/formula': TASK_VISIBLE_ONE,
  'POST /custom-fields/formulas/validate':
    'проверка AST без записи — нужна редактору формул каждому, кто может править атрибуты ' +
    'своих записей; данные реестра не персональные (как чтение реестра #431)',
  'POST /custom-fields/formulas/evaluate':
    'превью без записи: доступ к контексту проверяет резолвер источника (Р7) — ' +
    'невидимый хост/источник даёт 404 без оракула',
  'PUT /tasks/:id/custom-fields/:fieldId/formula': TASK_ACCESS,
  'DELETE /tasks/:id/custom-fields/:fieldId/formula': TASK_ACCESS,
  'POST /tasks/:id/move-preview': TASK_ACCESS,
  'GET /tasks/personal-stages': PERSONAL_PLAN,
  // Изменения (#320)
  'POST /auth/logout-all': SELF,
  'DELETE /auth/sessions/:id': SELF,
  'POST /auth/change-password': SELF,
  'PATCH /directory/users/me': SELF,
  'POST /directory/users/me/avatar': SELF,
  'DELETE /directory/users/me/avatar': SELF,
  'PATCH /notifications/settings': SELF,
  'POST /notifications/read-by-source': SELF,
  'POST /notifications/:id/read': SELF,
  'POST /chat/conversations': CHAT_MEMBERSHIP,
  'PATCH /chat/conversations/:id': CHAT_MEMBERSHIP,
  'PUT /chat/conversations/:id/draft': CHAT_MEMBERSHIP,
  'PATCH /chat/conversations/:id/info': CHAT_MEMBERSHIP,
  'POST /chat/conversations/:id/avatar': CHAT_MEMBERSHIP,
  'DELETE /chat/conversations/:id/avatar': CHAT_MEMBERSHIP,
  'POST /chat/conversations/:id/members': CHAT_MEMBERSHIP,
  'PATCH /chat/conversations/:id/members/:userId': CHAT_MEMBERSHIP,
  'DELETE /chat/conversations/:id/members/:userId': CHAT_MEMBERSHIP,
  'POST /chat/conversations/:id/read': CHAT_MEMBERSHIP,
  'POST /chat/conversations/:id/threads/:rootId/watch': CHAT_MEMBERSHIP,
  'POST /chat/conversations/:id/messages/:messageId/pin': CHAT_MEMBERSHIP,
  'DELETE /chat/conversations/:id/messages/:messageId/pin': CHAT_MEMBERSHIP,
  'POST /chat/conversations/:id/messages/:messageId/reactions': CHAT_MEMBERSHIP,
  'POST /chat/conversations/:id/forward': CHAT_MEMBERSHIP,
  'POST /chat/conversations/:id/messages': CHAT_MEMBERSHIP,
  'PATCH /chat/conversations/:id/messages/:messageId': CHAT_MEMBERSHIP,
  'DELETE /chat/conversations/:id/messages/:messageId': CHAT_MEMBERSHIP,
  'POST /chat/conversations/:id/messages/batch-delete': CHAT_MEMBERSHIP,
  'POST /chat/attachments': CHAT_MEMBERSHIP,
  'DELETE /chat/attachments/:id': CHAT_MEMBERSHIP,
  'POST /chat/favorites': OWN_FAVORITES,
  'PATCH /chat/favorites/:messageId': OWN_FAVORITES,
  'DELETE /chat/favorites/:messageId': OWN_FAVORITES,
  'POST /chat/stickers/packs': STICKER_OWNER,
  'PATCH /chat/stickers/packs/:id': STICKER_OWNER,
  'DELETE /chat/stickers/packs/:id': STICKER_OWNER,
  'POST /chat/stickers/packs/:id/stickers': STICKER_OWNER,
  'DELETE /chat/stickers/stickers/:id': STICKER_OWNER,
  'POST /chat/stickers/packs/:id/install': SELF,
  'DELETE /chat/stickers/packs/:id/install': SELF,
  'POST /tasks/bulk': TASK_ACCESS,
  'PATCH /tasks/:id': TASK_ACCESS,
  'DELETE /tasks/:id': TASK_ACCESS,
  'POST /tasks/:id/participants': TASK_ACCESS,
  'DELETE /tasks/:id/participants/:userId': TASK_ACCESS,
  'POST /tasks/:id/checklist': TASK_ACCESS,
  'PATCH /tasks/:id/checklist/:itemId': TASK_ACCESS,
  'DELETE /tasks/:id/checklist/:itemId': TASK_ACCESS,
  'POST /tasks/:id/relations': TASK_ACCESS,
  'DELETE /tasks/:id/relations/:relationId': TASK_ACCESS,
  'POST /tasks/:id/results': TASK_ACCESS,
  'POST /tasks/:id/transitions/:transitionId': TASK_ACCESS,
  'POST /tasks/:id/type': TASK_ACCESS,
  'POST /tasks/:id/time-entries': TASK_ACCESS,
  'DELETE /tasks/time-entries/:entryId': TASK_ACCESS,
  'POST /tasks/:id/timer/start': TASK_ACCESS,
  'POST /tasks/timer/stop': SELF,
  'POST /tasks/personal-stages': PERSONAL_PLAN,
  'PATCH /tasks/personal-stages/:stageId': PERSONAL_PLAN,
  'DELETE /tasks/personal-stages/:stageId': PERSONAL_PLAN,
};

/** Публичные маршруты (`@Public`: без аутентификации вообще) — любой метод. */
export const INTENTIONALLY_PUBLIC: Record<string, string> = {
  'GET /health': 'проба живости для docker/мониторинга',
  'GET /health/live': 'проба живости для docker/мониторинга',
  'GET /health/ready': 'проба готовности для docker/мониторинга',
  'POST /auth/login': 'вход — до аутентификации по определению',
  'POST /auth/refresh': 'ротация по httpOnly refresh-cookie (access истёк)',
  'POST /auth/logout': 'отзыв сессии по refresh-cookie (access мог истечь)',
  'GET /desktop/config': 'оболочка читает имя сервера и минимальную версию до входа',
  'GET /files/:id/content': 'подписанная ссылка (HMAC + срок) — доступ проверен при выдаче',
  'GET /files/:id/derivative/:kind':
    'подписанная ссылка (HMAC + срок) — доступ проверен при выдаче',
  'GET /files/office-config': 'параметры движка просмотра без данных пользователя',
  'POST /files/:id/office-callback':
    'вызов ONLYOFFICE DS — отправитель проверяется verifySender (JWT DS)',
};
