import { accessStrings } from './ru-access.js';
import { automationStrings } from './ru-automation.js';
import { chatStrings } from './ru-chat.js';
import { lettersStrings } from './ru-correspondence.js';
import { counterpartiesStrings } from './ru-crm.js';
import { customFieldsStrings } from './ru-custom-fields.js';
import { formulasStrings } from './ru-formulas.js';
import { formsStrings } from './ru-forms.js';
import { employeesStrings } from './ru-employees.js';
import { filesStrings } from './ru-files.js';
import { notificationsStrings } from './ru-notifications.js';
import { taskCreateStrings } from './ru-task-create.js';
import { tasksStrings } from './ru-tasks.js';
import { nodeKindsStrings } from './ru-node-kinds.js';
import { structureStrings } from './ru-structure.js';
import { projectsStrings } from './ru-projects.js';
import { whatsNewStrings } from './ru-whats-new.js';

/** Русские строки кодов ошибок — в ru-errors.ts (I5: словарь вырос). */
export { errorMessages } from './ru-errors.js';

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
    closeTab: 'Закрыть вкладку',
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
    linkOpenError: 'Не удалось открыть ссылку',
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
  /** Области вкладок карточек (#746): сплит/merge, меню, объявления. */
  cardTabs: {
    split: 'Разделить область вкладок',
    merge: 'Соединить области',
    moveLeft: 'Переместить влево',
    moveRight: 'Переместить вправо',
    moveToArea: 'Переместить в другую область',
    openBeside: 'Открыть рядом',
    mergeAreas: 'Соединить области',
    hideTab: 'Скрыть вкладку',
    maxAreas: 'Пока максимум две области',
    areaCollapsed: 'Вторая область свёрнута — не хватает ширины',
    panelHidden: 'Панель скрыта — расширьте карточку',
    areaLabel: 'Область вкладок {n}',
    resize: 'Изменить ширину областей',
    reordered: 'Вкладка «{tab}» перемещена: позиция {index}',
    movedToArea: 'Вкладка «{tab}» перемещена в область {area}',
    openedBeside: 'Вкладка «{tab}» открыта рядом',
    merged: 'Области соединены',
    hidden: 'Вкладка «{tab}» скрыта',
    splitDone: 'Создана вторая область вкладок',
    focusArea: 'Область {n}',
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
  /** Виды папок как настраиваемые типы (#556) — панель и группа. */
  nodeKinds: nodeKindsStrings,
  automation: automationStrings,
  access: accessStrings,
  customFields: customFieldsStrings,
  /** Формулы в ячейках атрибутов (#632): редактор, ячейка, колонки, перенос. */
  formulas: formulasStrings,
  /** Конструктор окон ввода и замок записи (#496). */
  forms: formsStrings,
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
    downloadTitle: 'Файл скачан',
    downloadErrorTitle: 'Не удалось скачать файл',
    downloadShowInFolder: 'Показать в папке',
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
