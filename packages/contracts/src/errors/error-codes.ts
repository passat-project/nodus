/**
 * Коды ошибок API (канон — `docs/architecture/api-conventions.md`).
 *
 * Системные коды обязательны к единому использованию всеми механизмами
 * (фильтр ошибок, пайпы, гварды, rate-limit). Доменные коды добавляются
 * модулями по маске `MODULE_REASON` (`TASK_INVALID_STAGE_TRANSITION`).
 * Каталог только расширяется: переименование кода ломает клиентов (i18n по
 * коду, I15). До пилота переименования допустимы решением владельца —
 * `TASK_TYPE_*` → `PROCESS_TYPE_*` в #428 (ADR-0024).
 */
export const ErrorCode = {
  /** zod/валидация входа; details.issues — список нарушений. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** Нет или просрочена аутентификация. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** Нет права (RBAC). */
  FORBIDDEN: 'FORBIDDEN',
  /** Сущность не найдена / нет доступа. */
  NOT_FOUND: 'NOT_FOUND',
  /** Конфликт состояния (в т.ч. идемпотентность с иным payload). */
  CONFLICT: 'CONFLICT',
  /** Превышен лимит запросов. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Непредвиденное (без деталей наружу). */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** Тело запроса или файл больше лимита (multipart, bodyLimit). */
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  /** Content-Type запроса маршрут не поддерживает. */
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',

  // Доменные коды модулей (маска MODULE_REASON):
  /** Неверный email или пароль (без уточнения — защита от перебора учёток). */
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  /** Сессия отозвана, просрочена или refresh-токен скомпрометирован (reuse). */
  AUTH_SESSION_INVALID: 'AUTH_SESSION_INVALID',
  /** Пользователь с таким email уже существует. */
  DIRECTORY_EMAIL_TAKEN: 'DIRECTORY_EMAIL_TAKEN',
  /** Ссылка оргструктуры на несуществующий/неактивный объект или чужой вид
   *  структуры (руководитель, подразделение, должность) — 400, details.field. */
  DIRECTORY_REFERENCE_INVALID: 'DIRECTORY_REFERENCE_INVALID',
  /** Удаление единственной личной стадии «Моего плана» запрещено (ADR-0008). */
  TASK_LAST_STAGE: 'TASK_LAST_STAGE',
  /** Перехода в целевую стадию нет в маршруте или условия «кто» не пройдены
   *  (ADR-0020; общий код движка любой категории — с #55, O7). */
  WORKFLOW_TRANSITION_NOT_ALLOWED: 'WORKFLOW_TRANSITION_NOT_ALLOWED',
  /** Гейт DoR/DoD не пройден; details.reasons — TransitionBlockReason[] (ADR-0020). */
  WORKFLOW_TRANSITION_BLOCKED: 'WORKFLOW_TRANSITION_BLOCKED',
  /** Введённое в окне перехода не совпало с настройкой кнопки: лишний или
   *  пропущенный обязательный раздел; details — { transitionId, missing[], unexpected[] } (#380). */
  WORKFLOW_TRANSITION_FORM_INVALID: 'WORKFLOW_TRANSITION_FORM_INVALID',
  /** Обход гейта без причины или без права task.override_gate. */
  WORKFLOW_OVERRIDE_REASON_REQUIRED: 'WORKFLOW_OVERRIDE_REASON_REQUIRED',
  /** Пост-действие «Присвоить номер», а у типа нет серии номеров (#55, Р2). */
  WORKFLOW_NUMBERING_NOT_CONFIGURED: 'WORKFLOW_NUMBERING_NOT_CONFIGURED',
  /** Родитель задачи образует цикл (задача — предок самой себя). */
  TASK_PARENT_CYCLE: 'TASK_PARENT_CYCLE',
  /** Остановка таймера, который не идёт (старт нового сам останавливает старый). */
  TASK_TIMER_NOT_RUNNING: 'TASK_TIMER_NOT_RUNNING',
  /** Публикация маршрута: версия ушла вперёд (409; ADR-0021, #378). */
  WORKFLOW_VERSION_CONFLICT: 'WORKFLOW_VERSION_CONFLICT',
  /** Документ маршрута не проходит проверки; details.problems — WorkflowProblem[] (#378). */
  WORKFLOW_INVALID: 'WORKFLOW_INVALID',
  /** У архивируемых стадий есть задачи, а перенос не задан; details.stages — [{ stageId, count }] (#378). */
  WORKFLOW_MIGRATION_REQUIRED: 'WORKFLOW_MIGRATION_REQUIRED',
  /** Системный тип процесса нельзя архивировать (#378, #428); типы и
   *  маршруты писем до #463/#464 — только просмотр: details.reason =
   *  'letter_catalog' (#55, Р4). */
  PROCESS_TYPE_SYSTEM_LOCKED: 'PROCESS_TYPE_SYSTEM_LOCKED',
  /** Доступ к типу процесса закрыт (#432, Р6): не видит (`view`), не создаёт
   *  (`create`) или тип скрыт от создания (`not_creatable`); details — { typeId, reason }. */
  PROCESS_TYPE_FORBIDDEN: 'PROCESS_TYPE_FORBIDDEN',
  /** Не заполнены обязательные при создании поля формы типа (#432, Р5);
   *  details — { typeId, fields, reason: create|clear }. */
  PROCESS_TYPE_FIELDS_REQUIRED: 'PROCESS_TYPE_FIELDS_REQUIRED',
  /** Скрытое значение формы стало недействительным — уволенный сотрудник,
   *  удалённый вариант (#432, Р4); details — { typeId, fields }. */
  PROCESS_TYPE_PRESET_INVALID: 'PROCESS_TYPE_PRESET_INVALID',
  /** Привязка неверна (#631, Р3): архивный тип процесса или привязка у
   *  глобальной переменной; details — { targetKind, targetId } (неизвестная
   *  цель — 404, чтобы не раскрывать чужие справочники). */
  CUSTOM_FIELD_BINDING_INVALID: 'CUSTOM_FIELD_BINDING_INVALID',
  /** Название типа процесса уже занято живым типом (#378, #428). */
  PROCESS_TYPE_NAME_TAKEN: 'PROCESS_TYPE_NAME_TAKEN',
  /** Вложение чата больше лимита (100 МБ на файл; серверная сверка, #57). */
  CHAT_ATTACHMENT_TOO_LARGE: 'CHAT_ATTACHMENT_TOO_LARGE',
  /** Больше 20 загруженных-но-неотправленных вложений у пользователя (#57). */
  CHAT_ATTACHMENT_TOO_MANY: 'CHAT_ATTACHMENT_TOO_MANY',
  /** Файл стикера не прошёл проверку: формат (magic bytes) или лимит (#143). */
  CHAT_STICKER_INVALID: 'CHAT_STICKER_INVALID',
  /** Аватар не прошёл проверку: не изображение PNG/JPEG/WebP или больше
   *  лимита (квадратизация — серверная, sharp, #186). */
  FILE_AVATAR_INVALID: 'FILE_AVATAR_INVALID',
  /** Суточный лимит «важных сообщений» отправителя исчерпан (#100). */
  CHAT_URGENT_LIMIT_EXCEEDED: 'CHAT_URGENT_LIMIT_EXCEEDED',
  /** «Важное сообщение» в беседе больше 20 участников запрещено (#100, I8). */
  CHAT_URGENT_GROUP_TOO_LARGE: 'CHAT_URGENT_GROUP_TOO_LARGE',
  /** Лимит участников беседы (200) достигнут — добавление отклонено (#186). */
  CHAT_MEMBERS_LIMIT_REACHED: 'CHAT_MEMBERS_LIMIT_REACHED',
  /** Фактический размер файла не совпал с заявленным (обрыв/подмена, #57). */
  FILE_SIZE_MISMATCH: 'FILE_SIZE_MISMATCH',
  /** Файл помещён в карантин (сканер пометил) и не отдаётся (ADR-0013). */
  FILE_QUARANTINED: 'FILE_QUARANTINED',
  /** Движок офисного просмотра выключен (ONLYOFFICE не поднят, #138). */
  FILE_OFFICE_DISABLED: 'FILE_OFFICE_DISABLED',
  /** Формат не открывается в ONLYOFFICE (реестр office-formats, #138). */
  FILE_OFFICE_UNSUPPORTED: 'FILE_OFFICE_UNSUPPORTED',
  /** Файл больше потолка открытия в редакторе (#138; открывается скачиванием). */
  FILE_OFFICE_TOO_LARGE: 'FILE_OFFICE_TOO_LARGE',
  /** Контрагент с таким УНП уже есть в справочнике (в т.ч. в архиве);
   *  details — { counterpartyId, shortName, archived } (#460). */
  CRM_UNP_TAKEN: 'CRM_UNP_TAKEN',
  /** Контрагент в архиве: сначала верните его из архива (#460). */
  CRM_COUNTERPARTY_ARCHIVED: 'CRM_COUNTERPARTY_ARCHIVED',
  /** Удалить нельзя: на контрагента ссылаются письма или проекты —
   *  перенесите в архив, история должна сохраниться (#460). */
  CRM_COUNTERPARTY_IN_USE: 'CRM_COUNTERPARTY_IN_USE',
  /** Удалить нельзя: контакт — подписант писем; архивируйте контакт (#55). */
  CRM_CONTACT_IN_USE: 'CRM_CONTACT_IN_USE',
  /** Повторная регистрация: письмо уже зарегистрировано; details — { regNumber } (#55, Р3). */
  LETTER_ALREADY_REGISTERED: 'LETTER_ALREADY_REGISTERED',
  /** Ввод регистрации или правки не прошёл проверку (дата, подписант не из
   *  контактов корреспондента, уволенный адресат); details — { field, reason } (#55). */
  LETTER_REGISTRATION_INVALID: 'LETTER_REGISTRATION_INVALID',
  /** Удалить как спам можно только незарегистрированное письмо из «Новых» (#55, Р12). */
  LETTER_NOT_DELETABLE: 'LETTER_NOT_DELETABLE',
  /** Править регистрационные данные можно только у зарегистрированного письма (#55, Р11). */
  LETTER_NOT_EDITABLE: 'LETTER_NOT_EDITABLE',
  /** Подтверждение связи «ответ на» не прошло: цель не исходящее
   *  зарегистрированное письмо или не совпадает со свежей подсказкой;
   *  details — { field, reason } (#56, Р5). */
  LETTER_RELATION_INVALID: 'LETTER_RELATION_INVALID',
  /** Значение кастомного поля не прошло проверку (#431, ADR-0029):
   *  details.issues[] — { fieldId, reason: unknown|invalid|not_found|inactive|not_in_type, message }. */
  CUSTOM_FIELD_VALUE_INVALID: 'CUSTOM_FIELD_VALUE_INVALID',
  /** Имя занято атрибутом портала; details — { suggestion: {definitionId, name} } (#431, В3). */
  CUSTOM_FIELD_NAME_TAKEN: 'CUSTOM_FIELD_NAME_TAKEN',
  /** Смена типа несовместима с хранимыми значениями; details — { from, to } (#431, Р3). */
  CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE: 'CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE',
  /** Технический потолок 1000 атрибутов портала (страховка, #631 Р12);
   *  продуктового лимита нет — текст просит обратиться к разработчикам. */
  CUSTOM_FIELD_LIMIT_REACHED: 'CUSTOM_FIELD_LIMIT_REACHED',
  /** Формула не разбирается как AST или содержит неизвестную функцию (#632, Р2). */
  FORMULA_AST_INVALID: 'FORMULA_AST_INVALID',
  /** Результат формулы не совпадает с типом атрибута-ячейки (#632, Р2/Р13). */
  FORMULA_TYPE_MISMATCH: 'FORMULA_TYPE_MISMATCH',
  /** Источник формулы недоступен носителю (#632, матрица Р2/Р7);
   *  details — { source, hostKind }. */
  FORMULA_SOURCE_FORBIDDEN: 'FORMULA_SOURCE_FORBIDDEN',
  /** Превышен лимит языка: глубина/узлы/источники/литерал (#632, Р2). */
  FORMULA_LIMIT_EXCEEDED: 'FORMULA_LIMIT_EXCEEDED',
  /** В формульную ячейку нельзя вписать значение руками (#632, решение
   *  владельца по #660): значение пишет только формула — своя или типа/вида. */
  FORMULA_CELL_LOCKED: 'FORMULA_CELL_LOCKED',
  /** Поле закреплено окном создания или кнопкой (#496, Р4): ручная правка
   *  запрещена или нужна причина; details — `fieldLockedDetailsSchema`
   *  { keys, reason: locked|owners_only|reason_required }. HTTP 422. */
  FIELD_LOCKED: 'FIELD_LOCKED',
  /** У записи нет контейнера счёта (#630): задача не лежит в папке нужного
   *  вида, у проекта нет портфеля, поле пусто — номер не выдан, кнопка не
   *  проходит, счётчик не сдвигается. `details.reason` — причина. */
  NUMBER_CONTAINER_MISSING: 'NUMBER_CONTAINER_MISSING',
  /** Привязка несовместима с «внутри чего свой счёт» (#630): записи этого
   *  вида не лежат в таком контейнере (письма — не в папках, проект — не
   *  в проекте). `details.targets` — несовместимые привязки. */
  NUMBER_CONTAINER_UNREACHABLE: 'NUMBER_CONTAINER_UNREACHABLE',
  /** Номера уже выдавались — «внутри чего» и «начинать заново» не меняются
   *  (#630): иначе номера начнут повторяться; считать иначе — новый счётчик. */
  NUMBER_RULE_LOCKED: 'NUMBER_RULE_LOCKED',
  /** «Следующий номер» меньше уже выданного (#630): только вперёд. */
  NUMBER_NEXT_BACKWARDS: 'NUMBER_NEXT_BACKWARDS',
  /** У счётчика нет формул — ни у привязки, ни в ячейке (#630): номер
   *  выдаёт только кнопка процесса. */
  COUNTER_FORMULA_FORBIDDEN: 'COUNTER_FORMULA_FORBIDDEN',
  /** Счётчик руками не пишется (#630, Р10): номер выдаёт только движок. */
  NUMBER_CELL_IMMUTABLE: 'NUMBER_CELL_IMMUTABLE',
  /** В виде номера есть поле, пустое у этой записи (#630, вердикт 08.11):
   *  без подтверждения (`confirmEmptyNumberParts`) номер не выдан и не
   *  потрачен — окно «выдать так / вернуться». `details.segments` — какие. */
  NUMBER_SEGMENT_EMPTY: 'NUMBER_SEGMENT_EMPTY',
  /** «При создании» указан для не привязанного типа или невозможен этому
   *  виду записей (письмо со счётом по месту или полями письма) (#630). */
  NUMBER_TRIGGER_INVALID: 'NUMBER_TRIGGER_INVALID',
  /** Выдача существующим: записей без номера стало другое число, чем в
   *  предпросмотре (#630) — показать свежий предпросмотр. */
  NUMBER_BACKFILL_STALE: 'NUMBER_BACKFILL_STALE',
  /** Системный справочник защищён от удаления вариантов и переименования (#431, Р10). */
  DICTIONARY_SYSTEM_LOCKED: 'DICTIONARY_SYSTEM_LOCKED',
  /** Вариант с таким названием уже есть среди активных (#431). */
  DICTIONARY_ITEM_NAME_TAKEN: 'DICTIONARY_ITEM_NAME_TAKEN',
  /** Права системной роли «Администратор» неизменяемы (409); details — { roleId, code } (#379). */
  ROLE_LOCKED: 'ROLE_LOCKED',
  /** Выдать можно только право, которое есть у самого актора (403);
   *  details — { permissions } (#379, ADR-0034). */
  ROLE_PERMISSION_NOT_HELD: 'ROLE_PERMISSION_NOT_HELD',
  /** Нельзя убрать из роли «Администратор» последнего сотрудника — портал
   *  остался бы без администратора (409; #379, ADR-0034). */
  ROLE_LAST_ADMIN: 'ROLE_LAST_ADMIN',
  /** Узел структуры не подходит: не найден, чужой проект или не совпадает с
   *  проектом задачи (422, без оракула — не раскрывает существование; #467). */
  PROJECT_NODE_INVALID: 'PROJECT_NODE_INVALID',
  /** Перенос узла в собственного потомка (409; #467). */
  PROJECT_NODE_CYCLE: 'PROJECT_NODE_CYCLE',
  /** Удалить можно только пустой узел — в нём задачи или дочерние узлы (409;
   *  архивации узлов нет, вердикт 30.10; #467). */
  PROJECT_NODE_NOT_EMPTY: 'PROJECT_NODE_NOT_EMPTY',
  /** Шифр узла уже занят в этом проекте (409; #467). */
  PROJECT_NODE_CODE_TAKEN: 'PROJECT_NODE_CODE_TAKEN',
  /** Лимит структуры достигнут: узлов в проекте / детей у узла / глубина /
   *  размер пакета (409; #467). */
  PROJECT_NODE_LIMIT_REACHED: 'PROJECT_NODE_LIMIT_REACHED',
  /** Вид папки в архиве — создавать папки такого вида нельзя (409; #467). */
  PROJECT_NODE_KIND_ARCHIVED: 'PROJECT_NODE_KIND_ARCHIVED',
  /** Название вида папки уже занято (409; #467). */
  PROJECT_NODE_KIND_NAME_TAKEN: 'PROJECT_NODE_KIND_NAME_TAKEN',
  /** Вид папки не входит в допустимые виды типа проекта (422; #556). */
  PROJECT_NODE_KIND_NOT_ALLOWED: 'PROJECT_NODE_KIND_NOT_ALLOWED',
  /** Обязательные поля формы вида не заполнены: создание, смена вида или
   *  очистка (`details.reason`: create | kind_change | clear; 422; #556). */
  PROJECT_NODE_FIELDS_REQUIRED: 'PROJECT_NODE_FIELDS_REQUIRED',
  /** В задаче секретного проекта указаны сотрудники, которые не могут получать
   *  задачи: не участники проекта или только наблюдатели; details — { projectId, userIds }
   *  (422; #674). */
  PROJECT_TASK_MEMBERS_INVALID: 'PROJECT_TASK_MEMBERS_INVALID',
  /** Обязательные слоты формы типа проекта не заполнены/очищаются
   *  (`details.reason`: create | clear; 422; #631 Р10). */
  PROJECT_FIELDS_REQUIRED: 'PROJECT_FIELDS_REQUIRED',
  /** Форма вида ссылается на негодные атрибуты (`details.reason`:
   *  unknown_field | hidden_field; 422; #556). */
  PROJECT_NODE_KIND_FORM_INVALID: 'PROJECT_NODE_KIND_FORM_INVALID',
  /** Форма типа проекта ссылается на негодные атрибуты (`details.reason`:
   *  unknown_field; 422; #631 Р10). */
  PROJECT_TYPE_FORM_INVALID: 'PROJECT_TYPE_FORM_INVALID',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Маска доменного кода: `MODULE_REASON` (SCREAMING_SNAKE с одним подчёркиванием-разделителем). */
export const DOMAIN_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/;
