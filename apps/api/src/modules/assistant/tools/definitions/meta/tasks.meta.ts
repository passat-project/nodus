import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания инструментов задач (#926). */
export const tasksMeta = {
  'tasks.list': {
    why: 'Показать задачи сотрудника списком: свои или все видимые, с фильтрами по сроку, стадии, проекту и исполнителю.',
    whenToUse:
      '«Покажи мои задачи на сегодня», «чё у меня по задачам», «какие задачи просрочены», «задачи по объекту Северный», «что у меня в работе».',
    whenNotToUse:
      'Не для счётчиков по стадиям (tasks.stages), не для карточки по номеру (tasks.search → tasks.get) и не для создания (tasks.create).',
    subject: 'задача',
    effect: 'read',
    example: {
      input: { scope: 'mine', overdue: true, limit: 10 },
      note: 'мои просроченные задачи',
    },
    returns: 'Строки задач: номер, название, стадия, срок, исполнитель, проект, id для tasks.get.',
    nextStep:
      'Для деталей — tasks.get по id; для хронологии — tasks.history; для смены стадии — tasks.transitions.',
    intent: 'list',
  },
  'tasks.get': {
    why: 'Показать карточку одной задачи по id: описание, стадия, срок, исполнитель, участники и трудозатраты.',
    whenToUse:
      '«Открой карточку задачи №1042», «что там по задаче 1042», «расскажи подробнее о задаче» — когда номер уже найден через tasks.search или id из списка.',
    whenNotToUse:
      'Не для списка задач (tasks.list), не для истории изменений (tasks.history) и не для смены полей (tasks.update).',
    subject: 'задача',
    effect: 'read',
    example: {
      input: { id: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d' },
      note: 'id из tasks.list или tasks.search',
    },
    returns:
      'Карточка задачи: номер, название, стадия, срок, исполнитель, постановщик, участники, трудозатраты, чек-лист, описание, id.',
    nextStep:
      'Для истории — tasks.history; для правки полей — tasks.update; для завершения — tasks.transitions.',
    intent: 'get',
  },
  'tasks.search': {
    why: 'Найти задачи по номеру или теме, когда точного id нет.',
    whenToUse:
      '«Найди задачу про смету», «задача 1042», «открой карточку задачи №1042» — номер или тема вместо id; затем tasks.get.',
    whenNotToUse:
      'Не для списка своих задач по фильтрам (tasks.list) и не для карточки, когда id уже известен (tasks.get).',
    subject: 'задача',
    effect: 'read',
    example: { input: { query: 'смета', scope: 'mine', limit: 10 }, note: 'поиск по теме задачи' },
    returns: 'Найденные задачи: номер, название, стадия, срок, исполнитель, id.',
    nextStep: 'Возьми id и вызови tasks.get; для хронологии — tasks.history.',
    intent: 'search',
  },
  'tasks.stages': {
    why: 'Распределение по стадиям со счётчиками и просрочками.',
    whenToUse:
      '«Что горит по стадиям», «где застряло», «сколько на стадии», «распределение по стадиям».',
    whenNotToUse:
      'Не для списка просроченных задач (tasks.list с overdue), не для истории (tasks.history) и не для перехода (tasks.transitions).',
    subject: 'стадия',
    effect: 'read',
    example: { input: { scope: 'all' }, note: 'стадии всех видимых задач со счётчиками' },
    returns: 'Стадии с id, типом, количеством задач и просроченных.',
    nextStep:
      'Для смены стадии передай id стадии в tasks.update или выполни переход через tasks.transitions.',
    intent: 'stages',
  },
  'tasks.history': {
    why: 'Показать историю изменений задачи: переходы, смены исполнителя и срока, комментарии.',
    whenToUse:
      '«Покажи историю задачи №1042», «кто менял задачу», «что было с задачей», «хронология изменений задачи».',
    whenNotToUse:
      'Не для карточки текущего состояния (tasks.get) и не для доступных переходов (tasks.transitions).',
    subject: 'история',
    effect: 'read',
    example: {
      input: { id: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d', limit: 20 },
      note: 'хронология одной задачи',
    },
    returns: 'Записи истории с датой, автором и сутью изменения.',
    nextStep: 'Для текущего состояния — tasks.get; для доступных переходов — tasks.transitions.',
    intent: 'history',
  },
  'tasks.transitions': {
    why: 'Показать доступные переходы задачи: кнопки маршрута, целевые стадии, ограничения и требования окна.',
    whenToUse:
      '«Заверши задачу», «закрой задачу», «верни задачу в работу», «что дальше можно сделать с задачей» — сначала доступные переходы, затем tasks.transition.',
    whenNotToUse:
      'Не для смены срока или исполнителя (tasks.update) и не для выполнения перехода без просмотра (tasks.transition).',
    subject: 'задача',
    effect: 'read',
    example: {
      input: { id: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d' },
      note: 'кнопки маршрута задачи',
    },
    returns: 'Переходы с id, названием, целевой стадией, ограничениями и требованиями окна.',
    nextStep: 'Выбери переход и вызови tasks.transition с его id и полями окна.',
    intent: 'transitions',
  },
  'tasks.transition': {
    why: 'Выполнить доступный переход: завершение, закрытие или возврат на прежнюю стадию.',
    whenToUse:
      '«Заверши», «закрой», «верни» или «смени стадию по маршруту» — после tasks.transitions, id перехода берётся оттуда.',
    whenNotToUse:
      'Не для смены срока, исполнителя или приоритета (tasks.update) и не для чтения доступных переходов (tasks.transitions).',
    subject: 'задача',
    effect: 'irreversible',
    example: {
      input: {
        id: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        transitionId: '7c2f3b4d-5e6a-4b7c-9d8e-0f1a2b3c4d5e',
        form: { comment: 'Работа выполнена' },
      },
      note: 'переход «Завершить» из tasks.transitions',
    },
    returns: 'Подтверждение перехода: задача, новая стадия, id.',
    nextStep: 'Сообщи сотруднику новую стадию; для следующего шага снова вызови tasks.transitions.',
    intent: 'transition',
  },
  'tasks.create': {
    why: 'Создать новое поручение от имени сотрудника с исполнителем, сроком и проектом.',
    whenToUse:
      '«Создай поручение», «поставь поручение на Петрова», «новое поручение в проект Северный», «назначь поручение с дедлайном».',
    whenNotToUse:
      'Не для правки существующей задачи (tasks.update) и не для перехода (tasks.transitions); исполнителя найди через directory.find_users.',
    subject: 'задача',
    effect: 'write',
    example: {
      input: {
        title: 'Подготовить раздел КЖ',
        projectId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        assigneeId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
        deadline: '2026-11-25T09:00:00.000Z',
        priority: 'high',
      },
      note: 'название обязательно, остальное по желанию',
    },
    returns: 'Карточка подтверждения; после выполнения — номер, название и id созданной задачи.',
    nextStep: 'Покажи карточку сотруднику; после выполнения открой задачу через tasks.get.',
    intent: 'create',
  },
  'tasks.update': {
    why: 'Изменить поля живой карточки: срок, исполнителя, приоритет, название и описание.',
    whenToUse:
      '«Перенеси срок на пятницу», «смени исполнителя», «поменяй приоритет», «перенеси срок на 25 ноября».',
    whenNotToUse:
      'Не для завершения и смены стадии по маршруту (tasks.transitions → tasks.transition) и не для создания задачи (tasks.create).',
    subject: 'задача',
    effect: 'irreversible',
    example: {
      input: {
        id: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        deadline: '2026-11-25T09:00:00.000Z',
      },
      note: 'новый срок; null в deadline убирает срок',
    },
    returns: 'Карточка подтверждения; после выполнения — обновлённая задача и id.',
    nextStep: 'После выполнения покажи изменения; если нужен переход маршрута — tasks.transitions.',
    intent: 'update',
  },
} satisfies Record<string, ToolStandard>;
