import { ErrorCode } from '../errors/error-codes.js';

import { accessStrings } from './ru-access.js';
import { automationStrings } from './ru-automation.js';
import { chatStrings } from './ru-chat.js';
import { lettersStrings } from './ru-correspondence.js';
import { counterpartiesStrings } from './ru-crm.js';
import { customFieldsStrings } from './ru-custom-fields.js';
import { employeesStrings } from './ru-employees.js';
import { filesStrings } from './ru-files.js';
import { notificationsStrings } from './ru-notifications.js';
import { taskCreateStrings } from './ru-task-create.js';
import { tasksStrings } from './ru-tasks.js';
import { structureStrings } from './ru-structure.js';
import { projectsStrings } from './ru-projects.js';
import { whatsNewStrings } from './ru-whats-new.js';

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
  [ErrorCode.CUSTOM_FIELD_BINDING_INVALID]: 'Атрибут нельзя привязать к этому типу',
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
  [ErrorCode.CUSTOM_FIELD_TYPE_UNAVAILABLE]: 'Этот тип атрибута пока недоступен',
  [ErrorCode.CUSTOM_FIELD_NAME_TAKEN]: 'Атрибут с таким названием уже есть',
  [ErrorCode.CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE]:
    'Тип нельзя сузить без потери данных — создайте новый атрибут',
  [ErrorCode.CUSTOM_FIELD_LIMIT_REACHED]: 'Атрибутов уже 100 — больше нельзя',
  [ErrorCode.CUSTOM_FIELD_IN_USE]:
    'Атрибут стоит в маршрутах процессов — сначала уберите его оттуда',
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
  [ErrorCode.PROJECT_NODE_KIND_ARCHIVED]: 'Этот вид уровня в архиве — выберите другой',
  [ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN]: 'Вид уровня с таким названием уже есть',
};

/**
 * Русские UI-строки портала (I15: компоненты не содержат хард-строк).
 * Терминология — русская деловая (ux-principles.md): без англицизмов.
 * I5-обоснование: плоский словарь строк по модулям (данные, не god-object);
 * единая точка терминологии — объект `ui`; доменные части свыше лимита строк
 * выносятся в соседние файлы-словари (ru-correspondence.ts) и собираются здесь.
 */
export const ui = {
  common: {
    create: 'Создать',
    save: 'Сохранить',
    cancel: 'Отмена',
    close: 'Закрыть',
    back: 'Назад',
    you: 'Вы',
    search: 'Поиск',
    add: 'Добавить',
    remove: 'Убрать',
    showAll: 'Показать все',
    notSet: 'Не задано',
    noDeadline: 'Без срока',
    pickDate: 'Выберите дату',
    online: 'онлайн',
    offline: 'не в сети',
    away: 'нет на месте',
    empty: 'Пока пусто',
    sendError: 'Не удалось отправить, попробуйте ещё раз',
    saveError: 'Не удалось сохранить изменение',
    loadError: 'Не удалось загрузить — обновите страницу',
    skipToContent: 'Перейти к содержимому',
    viewSettings: 'Настроить вид',
    viewFields: 'Отображаемые поля',
    resetView: 'Сбросить настройки',
    addField: 'Добавить поле',
    resizePanel: 'Изменить ширину панели',
    copyError: 'Не удалось скопировать',
    open: 'Открыть',
    resizeColumn: 'Изменить ширину колонки',
    copyLink: 'Копировать ссылку',
    linkCopied: 'Ссылка скопирована',
    selectAll: 'Выбрать все строки',
    selectRow: 'Выбрать строку',
    clearSelection: 'Снять выделение',
    bulkLimit: 'За один раз можно изменить не больше записей:',
    rowMenu: 'Действия строки',
    dateToday: 'Сегодня',
    dateTomorrow: 'Завтра',
    dateEndOfWeek: 'В конце недели',
    dateInAWeek: 'Через неделю',
    dateEndOfMonth: 'В конце месяца',
    timeLabel: 'Время',
    weekdaysShort: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    of: 'из',
    searchPlaceholder: 'Поиск…',
    sizeB: 'Б',
    sizeKb: 'КБ',
    sizeMb: 'МБ',
    errorTitle: 'Что-то пошло не так',
    errorDescription:
      'Попробуйте обновить страницу. Если ошибка повторяется — сообщите администратору.',
    notFoundTitle: 'Страница не найдена',
    notFoundDescription: 'Такого адреса нет или раздел был перемещён.',
    backHome: 'Вернуться на главную',
    reload: 'Обновить страницу',
    /** Аватарки (#186): общие строки чата и профиля сотрудника. */
    avatarUpload: 'Загрузить фото',
    avatarChange: 'Сменить фото',
    avatarRemove: 'Убрать фото',
    avatarTooLarge: 'Фото больше 10 МБ не поддерживается — выберите поменьше',
    avatarBadFormat: 'Нужно изображение: PNG, JPEG или WebP',
    avatarSaved: 'Фото обновлено',
  },
  /** Локальные поиск и фильтры списков (строка инструментов журнала/вкладки;
   *  панель фильтра выезжает из поисковой строки — отдельной кнопки нет,
   *  модель Битрикс24; глобальный «Умный поиск» — лупа в топбаре). */
  filters: {
    reset: 'Сбросить',
    save: 'Сохранить фильтр',
    savePlaceholder: 'Название фильтра…',
    pin: 'Применять по умолчанию',
    unpin: 'Не применять по умолчанию',
    deletePreset: 'Удалить фильтр',
    dateFrom: 'С',
    dateTo: 'По',
    numberFrom: 'От',
    numberTo: 'До',
    /** Заголовок группы фильтров «Атрибуты» (кастомные поля, #431). */
    groupFields: 'Атрибуты',
    any: 'Все',
    yes: 'Да',
    notFound: 'Ничего не найдено',
  },
  nav: {
    home: 'Главная',
    tasks: 'Задачи',
    letters: 'Корреспонденция',
    crm: 'CRM',
    counterparties: 'Контрагенты',
    projects: 'Проекты',
    chat: 'Мессенджер',
    employees: 'Сотрудники',
    automation: 'Автоматизация',
    collapse: 'Свернуть меню',
    expand: 'Развернуть меню',
    settings: 'Настройки',
    editOrder: 'Изменить порядок',
    applyForAll: 'Применить для всех',
    customizeDone: 'Применить',
    customizeForAll: 'Для всех',
    resetDefault: 'Вернуть по умолчанию',
    hiddenSection: 'Скрытое',
    dragToReorder: 'Перетащить для изменения порядка',
  },
  topbar: {
    searchHint: 'Ctrl+K',
    smartSearch: 'Умный поиск',
    smartSearchHint: 'Ищет по смыслу: задачи, письма, проекты, чаты, люди',
    notifications: 'Уведомления',
    notificationsEmpty: 'Новых уведомлений нет',
    profile: 'Профиль',
    logout: 'Выйти',
    themeToLight: 'Светлая тема',
    themeToDark: 'Тёмная тема',
    downloadApp: 'Скачать приложение',
    downloadAppHint: 'Приложение Nodus для Windows',
    downloadAppForWindows: 'Скачать для Windows',
    updateApp: 'Обновить приложение',
    updateAppRestart: 'Обновить и перезапустить',
    updateAvailable: 'Доступна новая версия',
    updateDownloading: 'Загружается обновление',
    updateNone: 'Новых версий нет',
  },
  edge: {
    expand: 'Развернуть список бесед',
    collapse: 'Свернуть список бесед',
  },
  auth: {
    title: 'Nodus',
    subtitle: 'Вход в корпоративный портал',
    email: 'Рабочая почта',
    password: 'Пароль',
    submit: 'Войти',
    submitting: 'Входим…',
    fallbackError: 'Не удалось войти, попробуйте ещё раз',
  },
  home: {
    greetMorning: 'Доброе утро',
    greetAfternoon: 'Добрый день',
    greetEvening: 'Добрый вечер',
    greetNight: 'Доброй ночи',
    statsEmployees: 'Сотрудников',
    statsProjectsDone: 'Проектов завершено',
    statsDataNodes: 'Узлов данных накоплено',
    birthdays: 'Дни рождения',
    today: 'сегодня',
    laborTitle: 'Трудозатраты команды',
    topOvertime: 'Топ по переработкам',
    hoursShort: 'ч',
    /** Заглушки блоков без данных: каркас витрины виден всегда (вердикт 01.10). */
    laborEmpty: 'Появятся с учётом рабочего времени',
    birthdaysEmpty: 'Дни рождения не заполнены в справочнике',
  },
  tasks: tasksStrings,
  /** Единое окно создания задачи (#432) — своя секция: строки окна общие
   *  для всех входов (страница задач, карточка сотрудника, чат, канбан). */
  taskCreate: taskCreateStrings,
  /** Дерево проекта (#467, ADR-0030) — своя секция: вкладка «Структура». */
  structure: structureStrings,
  automation: automationStrings,
  access: accessStrings,
  customFields: customFieldsStrings,
  letters: lettersStrings,
  counterparties: counterpartiesStrings,
  projects: projectsStrings,
  chat: chatStrings,
  files: filesStrings,
  notifications: notificationsStrings,
  whatsNew: whatsNewStrings,
  employees: employeesStrings,
  /** Отладочная точка сокета (`?wsdebug=1`, #104) — не продуктовый индикатор. */
  wsDebug: {
    connectedLabel: 'WS: подключено',
    disconnectedLabel: 'WS: нет соединения',
    connectedHint: 'WS-сокет подключён (?wsdebug=1)',
    disconnectedHint: 'WS-сокет отключён — реконнект/фолбэк (?wsdebug=1)',
  },
  desktop: {
    appTitle: 'Nodus',
    connectTitle: 'Подключение к порталу',
    connectHint: 'Введите адрес корпоративного портала Nodus — как в браузере.',
    addressLabel: 'Адрес портала',
    addressPlaceholder: 'например, portal.company.local',
    connect: 'Подключиться',
    connecting: 'Подключаемся…',
    connectedTo: 'Подключено к серверу',
    offlineTitle: 'Нет связи с сервером',
    offlineHint: 'Проверьте подключение к сети и доступность портала.',
    retry: 'Повторить',
    changeServer: 'Сменить сервер',
    invalidAddress: 'Введите адрес в формате portal.company.local или https://…',
    insecureWarning:
      'Адрес без шифрования (http): пароль и сообщения могут перехватить. Для работы используйте https-адрес сервера.',
    updateRequiredTitle: 'Обновите приложение Nodus',
    updateRequiredHint:
      'Эта версия оболочки больше не поддерживается сервером. Обновите приложение, чтобы продолжить.',
    updateNow: 'Обновить сейчас',
    updateUnavailable: 'Обновление пока недоступно — обратитесь к администратору',
    popupReply: 'Ответить',
    popupOpen: 'Открыть',
    popupSend: 'Отправить',
    popupReplyPlaceholder: 'Сообщение…',
    urgentLabel: 'Важное',
    hideAll: 'Скрыть все',
    attachmentImage: 'Фотография',
    attachmentImages: 'Фотографии',
    attachmentVideo: 'Видеозапись',
    attachmentAudio: 'Аудиозапись',
    attachmentPdf: 'PDF-документ',
    attachmentOffice: 'Документ',
    attachmentFile: 'Файл',
    attachmentSticker: 'Стикер',
    themeToggle: 'Тёмная тема',
  },
} as const;

export type UiStrings = typeof ui;
