import { ErrorCode } from '../errors/error-codes.js';

/**
 * Русские UI-строки для системных кодов ошибок (I15: `message` в ответе —
 * английский технический, пользователю показываем строку по `code`).
 * Доменные коды модулей добавляются сюда же по мере появления модулей.
 */
export const errorMessages: Record<ErrorCode, string> = {
  [ErrorCode.VALIDATION_FAILED]: 'Проверьте правильность заполнения полей',
  [ErrorCode.UNAUTHENTICATED]: 'Требуется вход в систему',
  [ErrorCode.FORBIDDEN]: 'Недостаточно прав для этого действия',
  [ErrorCode.NOT_FOUND]: 'Объект не найден или у вас нет к нему доступа',
  [ErrorCode.CONFLICT]: 'Действие конфликтует с текущим состоянием объекта',
  [ErrorCode.RATE_LIMITED]: 'Слишком много запросов, повторите чуть позже',
  [ErrorCode.INTERNAL_ERROR]: 'Внутренняя ошибка, мы уже разбираемся',
  [ErrorCode.PAYLOAD_TOO_LARGE]: 'Файл или данные запроса слишком большие',
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 'Формат данных запроса не поддерживается',
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: 'Неверный email или пароль',
  [ErrorCode.AUTH_SESSION_INVALID]: 'Сессия завершена, войдите снова',
  [ErrorCode.DIRECTORY_EMAIL_TAKEN]: 'Пользователь с таким email уже существует',
  [ErrorCode.DIRECTORY_REFERENCE_INVALID]:
    'Выбранный объект не существует, неактивен или не подходит по виду структуры',
  [ErrorCode.TASK_LAST_STAGE]: 'Единственную стадию удалить нельзя',
  [ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED]: 'Такой переход сейчас недоступен',
  [ErrorCode.WORKFLOW_TRANSITION_BLOCKED]: 'Переход заблокирован: не выполнены условия',
  [ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID]: 'Заполните окно перехода',
  [ErrorCode.WORKFLOW_OVERRIDE_REASON_REQUIRED]: 'Чтобы обойти условие, укажите причину',
  [ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED]:
    'У типа не настроена нумерация — номер присвоить нельзя, обратитесь к администратору',
  [ErrorCode.TASK_PARENT_CYCLE]: 'Задачу нельзя сделать подзадачей её же подзадачи',
  [ErrorCode.TASK_TIMER_NOT_RUNNING]: 'Таймер не запущен',
  [ErrorCode.WORKFLOW_VERSION_CONFLICT]: 'Маршрут уже изменили — загрузите свежую версию',
  [ErrorCode.WORKFLOW_INVALID]: 'Схема маршрута содержит проблемы — исправьте их',
  [ErrorCode.WORKFLOW_MIGRATION_REQUIRED]:
    'Удаляемые статусы содержат задачи — выберите, куда их перенести',
  [ErrorCode.PROCESS_TYPE_SYSTEM_LOCKED]: 'Системный тип так изменить нельзя',
  [ErrorCode.PROCESS_TYPE_FORBIDDEN]: 'Этот тип процесса вам недоступен',
  [ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED]: 'Заполните обязательные поля задачи',
  [ErrorCode.PROCESS_TYPE_PRESET_INVALID]:
    'Настройка типа ссылается на недоступное значение — обратитесь к администратору',
  [ErrorCode.CUSTOM_FIELD_BINDING_INVALID]: 'Место привязки недоступно — проверьте список мест',
  [ErrorCode.PROCESS_TYPE_NAME_TAKEN]: 'Тип с таким названием уже существует',
  [ErrorCode.CHAT_ATTACHMENT_TOO_LARGE]:
    'Файл больше 100 МБ — вложения такого размера не поддерживаются',
  [ErrorCode.CHAT_ATTACHMENT_TOO_MANY]:
    'Слишком много неотправленных вложений — сначала отправьте или уберите лишние',
  [ErrorCode.CHAT_STICKER_INVALID]:
    'Стикер не подошёл: нужны WebP/PNG до 512 КБ или WebM без звука до 256 КБ',
  [ErrorCode.CHAT_URGENT_LIMIT_EXCEEDED]:
    'Дневной лимит важных сообщений исчерпан — попробуйте завтра или напишите обычным сообщением',
  [ErrorCode.CHAT_URGENT_GROUP_TOO_LARGE]:
    'Важные сообщения не отправляют в беседы больше 20 участников',
  [ErrorCode.CHAT_MEMBERS_LIMIT_REACHED]: 'В беседе уже максимум участников (200)',
  [ErrorCode.FILE_SIZE_MISMATCH]: 'Файл передался не полностью — попробуйте ещё раз',
  [ErrorCode.FILE_QUARANTINED]: 'Файл заблокирован проверкой безопасности',
  [ErrorCode.FILE_OFFICE_DISABLED]: 'Просмотр документов недоступен — скачайте файл',
  [ErrorCode.FILE_OFFICE_UNSUPPORTED]: 'Этот формат не открывается в браузере — скачайте файл',
  [ErrorCode.FILE_OFFICE_TOO_LARGE]: 'Файл слишком большой для просмотра — скачайте его',
  [ErrorCode.FILE_AVATAR_INVALID]: 'Фото не подошло: нужно PNG, JPEG или WebP до 10 МБ',
  [ErrorCode.CRM_UNP_TAKEN]: 'Контрагент с таким УНП уже есть в справочнике',
  [ErrorCode.CRM_COUNTERPARTY_ARCHIVED]: 'Контрагент в архиве — сначала верните его',
  [ErrorCode.CRM_COUNTERPARTY_IN_USE]:
    'У контрагента есть письма или проекты — удалить нельзя, перенесите в архив',
  [ErrorCode.CRM_CONTACT_IN_USE]: 'Контакт подписывал письма — удалить нельзя, перенесите в архив',
  [ErrorCode.LETTER_ALREADY_REGISTERED]: 'Письмо уже зарегистрировано',
  [ErrorCode.LETTER_REGISTRATION_INVALID]: 'Проверьте отмеченные поля регистрации',
  [ErrorCode.LETTER_NOT_DELETABLE]: 'Удалить можно только незарегистрированное письмо из «Новых»',
  [ErrorCode.LETTER_NOT_EDITABLE]: 'Править данные можно только у зарегистрированного письма',
  [ErrorCode.LETTER_RELATION_INVALID]: 'Связь «ответ на» не подходит — проверьте подсказку',
  [ErrorCode.CUSTOM_FIELD_VALUE_INVALID]: 'Значение атрибута не подходит — проверьте отмеченные',
  [ErrorCode.CUSTOM_FIELD_NAME_TAKEN]: 'Атрибут с таким названием уже есть',
  [ErrorCode.CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE]:
    'Тип нельзя сузить без потери данных — создайте новый атрибут',
  [ErrorCode.CUSTOM_FIELD_LIMIT_REACHED]:
    'Достигнут технический предел числа атрибутов — обратитесь к разработчикам',
  [ErrorCode.FORMULA_AST_INVALID]: 'Формула не распознана — проверьте её в редакторе',
  [ErrorCode.FORMULA_TYPE_MISMATCH]:
    'Результат формулы не подходит к типу атрибута — измените формулу',
  [ErrorCode.FORMULA_SOURCE_FORBIDDEN]: 'В этой формуле нельзя использовать выбранный источник',
  [ErrorCode.FORMULA_LIMIT_EXCEEDED]: 'Формула слишком большая — упростите её',
  [ErrorCode.FORMULA_CELL_LOCKED]: 'Ячейку считает формула — вписать значение нельзя',
  [ErrorCode.FIELD_LOCKED]: 'Поле закреплено — изменить его вручную нельзя',
  [ErrorCode.NUMBER_CONTAINER_MISSING]:
    'Номер не выдан: запись не лежит там, где ведётся счёт (папка, проект или портфель)',
  [ErrorCode.NUMBER_CONTAINER_UNREACHABLE]:
    'Такие записи не лежат там, где ведётся счёт, — измените «Вести счёт отдельно для» или уберите тип',
  [ErrorCode.NUMBER_RULE_LOCKED]:
    'Номера уже выдавались — «Вести счёт отдельно для» и «Начинать заново» не меняются. Создайте новый счётчик',
  [ErrorCode.NUMBER_NEXT_BACKWARDS]:
    'Следующий номер не может быть меньше уже выданного — номера не повторяются',
  [ErrorCode.COUNTER_FORMULA_FORBIDDEN]: 'У счётчика нет формулы — номер выдаёт процесс',
  [ErrorCode.NUMBER_CELL_IMMUTABLE]: 'Номер счётчика выдаёт процесс — вписать вручную нельзя',
  [ErrorCode.NUMBER_SEGMENT_EMPTY]:
    'В номере есть незаполненное поле — подтвердите выдачу или сначала заполните поле',
  [ErrorCode.NUMBER_TRIGGER_INVALID]:
    'Этому типу нельзя выдавать номер при создании — выберите кнопку процесса',
  [ErrorCode.NUMBER_BACKFILL_STALE]:
    'Пока окно было открыто, записей без номера стало другое число — проверьте ещё раз',
  [ErrorCode.DICTIONARY_SYSTEM_LOCKED]: 'Системный справочник изменить нельзя',
  [ErrorCode.DICTIONARY_ITEM_NAME_TAKEN]: 'Такой вариант уже есть в списке',
  [ErrorCode.ROLE_LOCKED]: 'Права администратора не меняются — у него всегда все права',
  [ErrorCode.ROLE_PERMISSION_NOT_HELD]: 'Выдать можно только право, которое есть у вас',
  [ErrorCode.ROLE_LAST_ADMIN]: 'Нельзя убрать последнего администратора портала',
  [ErrorCode.PROJECT_NODE_INVALID]: 'Узел недоступен — проверьте структуру проекта',
  [ErrorCode.PROJECT_NODE_CYCLE]: 'Узел нельзя перенести внутрь самого себя',
  [ErrorCode.PROJECT_NODE_NOT_EMPTY]:
    'Узел не пустой — сначала перенесите из него задачи и дочерние узлы',
  [ErrorCode.PROJECT_NODE_CODE_TAKEN]: 'Шифр уже занят другим узлом этого проекта',
  [ErrorCode.PROJECT_NODE_LIMIT_REACHED]: 'Достигнут предел структуры проекта',
  [ErrorCode.PROJECT_NODE_KIND_ARCHIVED]: 'Этот вид папки в архиве — выберите другой',
  [ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN]: 'Вид папки с таким названием уже есть',
  [ErrorCode.PROJECT_NODE_FIELDS_REQUIRED]: 'Заполните обязательные поля папки',
  [ErrorCode.PROJECT_TASK_MEMBERS_INVALID]: 'У сотрудников нет доступа к секретному проекту',
  [ErrorCode.PROJECT_FIELDS_REQUIRED]: 'Заполните обязательные атрибуты проекта',
  [ErrorCode.PROJECT_NODE_KIND_FORM_INVALID]: 'Форма вида ссылается на негодные атрибуты',
  [ErrorCode.PROJECT_TYPE_FORM_INVALID]: 'Форма типа проекта ссылается на негодные атрибуты',
  [ErrorCode.PROJECT_NODE_KIND_NOT_ALLOWED]: 'Этот вид папки не назначен типу проекта',
};
