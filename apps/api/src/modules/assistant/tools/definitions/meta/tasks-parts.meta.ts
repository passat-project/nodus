import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания дневных действий задачи (#928). */
export const tasksPartsMeta = {
  'tasks.relations': {
    why: 'Показать связи задачи, чтобы найти id связанной задачи и не выдумывать его.',
    whenToUse:
      '«С чем связана задача», «что она блокирует», «зависимости задачи», перед tasks.add_relation.',
    whenNotToUse: 'Не для истории изменений (tasks.history) и не для подзадач (они в tasks.get).',
    subject: 'связь',
    effect: 'read',
    example: {
      input: { id: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d' },
      note: 'связи с номерами и id задач',
    },
    returns: 'Список связей: тип связи, направление, номер, название и id связанной задачи.',
    nextStep: 'Возьми id связанной задачи для tasks.get или tasks.add_relation.',
    intent: 'relations',
  },
  'tasks.actions': {
    why: 'Показать кнопки действий маршрута задачи с id, чтобы нажать нужную, а не угадывать.',
    whenToUse: '«Какие действия доступны», «что можно нажать», перед tasks.press_action.',
    whenNotToUse:
      'Не для смены статуса (tasks.transitions/tasks.transition) — действия статус не меняют.',
    subject: 'задача',
    effect: 'read',
    example: {
      input: { id: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d' },
      note: 'действия без смены статуса',
    },
    returns: 'Список действий: название, id, блокировка, наличие окна ввода.',
    nextStep: 'Передай id действия в tasks.press_action; при окне заполни form.',
    intent: 'transitions',
  },
  'tasks.checklist_add': {
    why: 'Добавить пункт в чек-лист задачи, чтобы зафиксировать шаг работы.',
    whenToUse: '«Добавь в чек-лист …», «пункт чек-листа …», «разбей на шаги» (один пункт).',
    whenNotToUse:
      'Не для отметки существующего пункта (tasks.checklist_update) и не для подзадачи (tasks.add_subtask).',
    subject: 'задача',
    effect: 'write',
    example: {
      input: { taskId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d', text: 'Проверить смету' },
      note: 'текст пункта до 300 знаков',
    },
    returns: 'Карточка подтверждения; после выполнения — текст и id пункта.',
    nextStep: 'После выполнения при необходимости отметь пункт через tasks.checklist_update.',
    intent: 'create',
  },
  'tasks.checklist_update': {
    why: 'Отметить пункт чек-листа выполненным, снять отметку или поправить текст.',
    whenToUse: '«Отметь пункт …», «чек-лист выполнен», «поправь пункт …», «сними отметку».',
    whenNotToUse:
      'Не для нового пункта (tasks.checklist_add) и не для закрытия задачи (tasks.transition).',
    subject: 'задача',
    effect: 'irreversible',
    example: {
      input: {
        taskId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        itemId: '7c2f3b4d-5e6a-4b7c-9d8e-0f1a2b3c4d5e',
        done: true,
      },
      note: 'itemId берётся из tasks.get (поле checklist)',
    },
    returns: 'Карточка подтверждения; после выполнения — текст пункта и новое состояние.',
    nextStep: 'Если все пункты выполнены, предложи tasks.transition для закрытия задачи.',
    intent: 'update',
  },
  'tasks.add_participant': {
    why: 'Добавить соисполнителя или наблюдателя в задачу.',
    whenToUse:
      '«Назначь Петрова соисполнителем», «назначь соисполнителем задачи», «добавь наблюдателя», «помоги по задаче».',
    whenNotToUse:
      'Не для смены ответственного (tasks.update) и не для постановки новой задачи (tasks.create).',
    subject: 'участник',
    alsoSubjects: ['задача'],
    effect: 'irreversible',
    example: {
      input: {
        taskId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        userId: '8d3a4c5e-6f7b-4c8d-9e0f-1a2b3c4d5e6f',
        role: 'coexecutor',
      },
      note: 'role: coexecutor или observer',
    },
    returns: 'Карточка подтверждения; после выполнения — роль и ссылка на задачу.',
    nextStep: 'Напиши сотруднику в чат задачи, если нужно объяснить работу.',
    intent: 'create',
  },
  'tasks.add_relation': {
    why: 'Связать задачу с другой: связана, блокирует, предшествует, дублирует.',
    whenToUse: '«Свяжи задачи», «эта задача блокирует …», «зависит от …», «дубликат задачи …».',
    whenNotToUse: 'Не для подзадачи (tasks.add_subtask) и не для смены статуса (tasks.transition).',
    subject: 'связь',
    alsoSubjects: ['задача'],
    effect: 'irreversible',
    example: {
      input: {
        taskId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        toTaskId: '9e4b5d6f-7a8c-4d9e-8f1a-2b3c4d5e6f7a',
        kind: 'blocks',
      },
      note: 'kind: relates | blocks | precedes | duplicates',
    },
    returns: 'Карточка подтверждения; после выполнения — тип связи и вторая задача.',
    nextStep: 'Покажи обе задачи ссылками, если сотрудник просил разобраться в зависимостях.',
    intent: 'create',
  },
  'tasks.add_result': {
    why: 'Записать итог задачи — текущий результат работы.',
    whenToUse: '«Запиши итог …», «результат задачи …», «что сделано по задаче» (как фиксация).',
    whenNotToUse:
      'Не для комментария в чат (chat.send) и не для закрытия задачи (tasks.transition).',
    subject: 'задача',
    effect: 'irreversible',
    example: {
      input: {
        taskId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        text: 'Смета проверена, замечания устранены',
      },
      note: 'текст итога до 5000 знаков',
    },
    returns: 'Карточка подтверждения; после выполнения — текст итога и ссылка на задачу.',
    nextStep: 'Если работа завершена, предложи tasks.transitions для перехода.',
    intent: 'create',
  },
  'tasks.add_subtask': {
    why: 'Создать подзадачу внутри задачи для декомпозиции работы.',
    whenToUse: '«Создай подзадачу …», «разбей задачу на части», «отдельная задача внутри этой».',
    whenNotToUse:
      'Не для пункта чек-листа (tasks.checklist_add) и не для независимой задачи (tasks.create).',
    subject: 'задача',
    effect: 'write',
    example: {
      input: {
        taskId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        title: 'Собрать исходные данные',
      },
      note: 'исполнитель и срок — по желанию',
    },
    returns: 'Карточка подтверждения; после выполнения — номер, название и ссылка на подзадачу.',
    nextStep: 'Назначь исполнителя подзадачи через tasks.update, если он не задан.',
    intent: 'create',
  },
  'tasks.log_time': {
    why: 'Записать отработанное время по задаче для учёта трудозатрат.',
    whenToUse: '«Залогируй 2 часа», «потратил 45 минут», «запиши трудозатраты за вчера».',
    whenNotToUse:
      'Не для таймера в реальном времени (его в ассистенте нет) и не для срока задачи (tasks.update).',
    subject: 'задача',
    effect: 'write',
    example: {
      input: {
        taskId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        minutes: 120,
        date: '2026-11-18',
        comment: 'Проверка сметы',
      },
      note: 'minutes 1–1440, date — календарный день',
    },
    returns: 'Карточка подтверждения; после выполнения — время, дата и ссылка на задачу.',
    nextStep: 'Покажи сумму трудозатрат за период, если сотрудник спросит.',
    intent: 'create',
  },
  'tasks.press_action': {
    why: 'Нажать кнопку действия маршрута задачи без смены статуса.',
    whenToUse: '«Нажми „Согласовать“», «приложи акт действием», после tasks.actions с id действия.',
    whenNotToUse:
      'Не для перехода статуса (tasks.transition) и не для правки полей (tasks.update).',
    subject: 'задача',
    effect: 'irreversible',
    example: {
      input: {
        taskId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        actionId: '0f1a2b3c-4d5e-4f6a-8b9c-0d1e2f3a4b5c',
      },
      note: 'actionId берётся из tasks.actions; form — поля окна',
    },
    returns:
      'Карточка подтверждения; после выполнения — задача и пометка, что статус не изменился.',
    nextStep: 'Если нужен переход статуса, вызови tasks.transitions и tasks.transition.',
    intent: 'transition',
  },
} satisfies Record<string, ToolStandard>;
