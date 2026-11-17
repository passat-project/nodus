import type { GoldenCase } from '../golden-set.types.js';

/** ГИП: свои задачи, карточки, стадии, история и проектные документы (часть 1). */
export const GIP_CASES_1: readonly GoldenCase[] = [
  {
    id: 'gip-tasks-01',
    role: 'gip',
    form: 'official',
    query: 'Покажи мои задачи на эту неделю',
    expectedTools: ['tasks.list'],
    forbiddenTools: ['chat.send'],
    rationale:
      'Список своих задач с фильтром по сроку — tasks.list; отправка сообщения к запросу не относится.',
  },
  {
    id: 'gip-tasks-02',
    role: 'gip',
    form: 'colloquial',
    query: 'Чё у меня по задачам?',
    expectedTools: ['tasks.list'],
    forbiddenTools: ['tasks.create'],
    rationale: 'Разговорный запрос про свои задачи — tasks.list; создавать задачу не просили.',
  },
  {
    id: 'gip-tasks-03',
    role: 'gip',
    form: 'typo',
    query: 'Какиие задачи у меня просрочены?',
    expectedTools: ['tasks.list'],
    forbiddenTools: ['tasks.stages'],
    rationale:
      'Просроченные свои задачи — tasks.list с overdue; стадии дают счётчики, а не список.',
  },
  {
    id: 'gip-tasks-04',
    role: 'gip',
    form: 'official',
    query: 'Покажи задачи по объекту «Северный»',
    expectedTools: ['projects.list', 'tasks.list'],
    forbiddenTools: ['chat.send'],
    rationale:
      'Сначала id проекта (projects.list), затем задачи проекта (tasks.list); чат не нужен.',
  },
  {
    id: 'gip-tasks-05',
    role: 'gip',
    form: 'official',
    query: 'Открой карточку задачи №1042',
    expectedTools: ['tasks.search', 'tasks.get'],
    forbiddenTools: ['tasks.update'],
    rationale: 'Номер ищется tasks.search, карточка — tasks.get; менять задачу не просили.',
  },
  {
    id: 'gip-tasks-06',
    role: 'gip',
    form: 'colloquial',
    query: 'Дай ссылку на карточку задачи 1042',
    expectedTools: ['tasks.search', 'ui.open_entity'],
    forbiddenTools: ['tasks.create'],
    rationale:
      'Номер находится tasks.search, ссылку готовит ui.open_entity; создание задачи не относится.',
  },
  {
    id: 'gip-tasks-07',
    role: 'gip',
    form: 'official',
    query: 'Заверши задачу №1042',
    expectedTools: ['tasks.transitions', 'tasks.transition'],
    forbiddenTools: ['tasks.update'],
    rationale:
      'Завершение — переход маршрута: сначала tasks.transitions, затем tasks.transition; stageId через tasks.update неверен.',
  },
  {
    id: 'gip-tasks-08',
    role: 'gip',
    form: 'typo',
    query: 'Верни задачу 1042 в работу',
    expectedTools: ['tasks.transitions', 'tasks.transition'],
    forbiddenTools: ['tasks.update'],
    rationale:
      'Обратный переход берётся из tasks.transitions и выполняется tasks.transition; tasks.update не знает маршрута.',
  },
  {
    id: 'gip-tasks-09',
    role: 'gip',
    form: 'colloquial',
    query: 'Что горит по стадиям?',
    expectedTools: ['tasks.stages'],
    forbiddenTools: ['tasks.transition'],
    rationale: 'Счётчики и просрочки по стадиям — tasks.stages; переходы задач не запрашивались.',
  },
  {
    id: 'gip-tasks-10',
    role: 'gip',
    form: 'official',
    query: 'Покажи историю изменений задачи №1042',
    expectedTools: ['tasks.search', 'tasks.history'],
    forbiddenTools: ['chat.send'],
    rationale: 'Номер ищется tasks.search, хронология — tasks.history; сообщение в чат не нужно.',
  },
  {
    id: 'gip-projects-01',
    role: 'gip',
    form: 'official',
    query: 'Какая структура у проекта «Северный»?',
    expectedTools: ['projects.list', 'projects.structure'],
    forbiddenTools: ['projects.add_node'],
    rationale:
      'Структура проекта — projects.structure после поиска id projects.list; создавать папку не просили.',
  },
  {
    id: 'gip-no-tool-01',
    role: 'gip',
    form: 'official',
    query: 'Создай новый проект «Северный-2»',
    expectedTools: ['projects.create'],
    forbiddenTools: ['projects.update', 'projects.add_node'],
    rationale:
      'Создание проекта — projects.create (#927); projects.update меняет название, add_node делает папку.',
  },
  {
    id: 'gip-no-tool-02',
    role: 'gip',
    form: 'colloquial',
    query: 'Удали задачу 1042, она лишняя',
    expectedTools: [],
    forbiddenTools: ['tasks.update', 'tasks.transition'],
    noToolCase: true,
    rationale:
      'Удаления задачи в каталоге нет: tasks.update и tasks.transition меняют, но не удаляют.',
  },
  {
    id: 'gip-no-tool-03',
    role: 'gip',
    form: 'typo',
    query: 'Загрзуи акт в проект «Северный»',
    expectedTools: [],
    forbiddenTools: ['files.extract_text', 'projects.add_node'],
    noToolCase: true,
    rationale:
      'Загрузки файлов в каталоге нет; files.extract_text только читает, add_node создаёт папку.',
  },
  {
    id: 'gip-clarify-01',
    role: 'gip',
    form: 'official',
    query: 'Добавь в проект «Северный» ещё одного инженера',
    expectedTools: [],
    forbiddenTools: ['projects.update'],
    shouldClarify: true,
    rationale:
      'Не назван сотрудник и его роль, поэтому projects.add_member без уточнения выбирать нельзя.',
  },
];
