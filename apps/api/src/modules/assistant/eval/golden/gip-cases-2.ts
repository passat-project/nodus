import type { GoldenCase } from '../golden-set.types.js';

/** ГИП: участники и папки проектов, письма, сотрудники, чаты, действия (часть 2). */
export const GIP_CASES_2: readonly GoldenCase[] = [
  {
    id: 'gip-projects-02',
    role: 'gip',
    form: 'official',
    query: 'Покажи состав участников проекта «Речной»',
    expectedTools: ['projects.list', 'projects.members'],
    forbiddenTools: ['projects.add_member'],
    rationale: 'Состав проекта — projects.members после поиска id; добавлять участника не просили.',
  },
  {
    id: 'gip-projects-03',
    role: 'gip',
    form: 'official',
    query: 'Добавь Петрова наблюдателем в проект «Северный»',
    expectedTools: ['directory.find_users', 'projects.add_member'],
    forbiddenTools: ['projects.update'],
    rationale:
      'Сначала id Петрова (directory.find_users), затем projects.add_member; правка проекта неверна.',
  },
  {
    id: 'gip-projects-04',
    role: 'gip',
    form: 'typo',
    query: 'Создай папку Рабочая докумнтация в проекте «Северный»',
    expectedTools: ['projects.structure', 'projects.add_node'],
    forbiddenTools: ['projects.add_member'],
    rationale:
      'Вид папки берётся из projects.structure, создаёт projects.add_node; участники не относятся.',
  },
  {
    id: 'gip-letters-01',
    role: 'gip',
    form: 'official',
    query: 'Письма по объекту «Северный» за последний месяц',
    expectedTools: ['letters.list'],
    forbiddenTools: ['letters.transition'],
    rationale:
      'Поиск писем по теме или корреспонденту — letters.list; переход по письму не запрашивался.',
  },
  {
    id: 'gip-letters-02',
    role: 'gip',
    form: 'colloquial',
    query: 'Прочитай акт из вложения последнего письма от «Стройпроекта»',
    expectedTools: ['letters.attachments', 'files.extract_text'],
    forbiddenTools: ['letters.transition'],
    rationale:
      'Сначала опись и fileId (letters.attachments), затем текст (files.extract_text); резолюция не нужна.',
  },
  {
    id: 'gip-letters-03',
    role: 'gip',
    form: 'typo',
    query: 'Пакажи карочку письма №128',
    expectedTools: ['letters.list', 'letters.get'],
    forbiddenTools: ['chat.send'],
    rationale: 'Номер ищется в реестре letters.list, карточка — letters.get; чат не относится.',
  },
  {
    id: 'gip-directory-01',
    role: 'gip',
    form: 'official',
    query: 'Найди сотрудника Петрова',
    expectedTools: ['directory.find_users'],
    forbiddenTools: ['directory.departments'],
    rationale: 'Поиск по имени — directory.find_users; дерево отделов не заменяет поиск человека.',
  },
  {
    id: 'gip-directory-02',
    role: 'gip',
    form: 'colloquial',
    query: 'Кто мой руководитель?',
    expectedTools: ['me.get'],
    forbiddenTools: ['directory.find_users'],
    rationale: 'Руководитель текущего сотрудника — me.get, а не поиск по справочнику.',
  },
  {
    id: 'gip-directory-03',
    role: 'gip',
    form: 'typo',
    query: 'Пакажи карточку Петрова',
    expectedTools: ['directory.find_users', 'directory.get_user'],
    forbiddenTools: ['me.get'],
    rationale:
      'Сначала id через directory.find_users, затем карточка directory.get_user; me.get только про себя.',
  },
  {
    id: 'gip-chat-01',
    role: 'gip',
    form: 'official',
    query: 'Что писали в чате задачи №1042?',
    expectedTools: ['chat.task_conversation', 'chat.messages'],
    forbiddenTools: ['chat.send'],
    rationale:
      'Чат задачи находится chat.task_conversation, сообщения — chat.messages; отправка не просили.',
  },
  {
    id: 'gip-chat-02',
    role: 'gip',
    form: 'colloquial',
    query: 'Отправь в чат задачи 1042, что акт готов',
    expectedTools: ['chat.task_conversation', 'chat.send'],
    forbiddenTools: ['chat.direct_message'],
    rationale:
      'Сначала беседа задачи (chat.task_conversation), затем chat.send; личка — другой адресат.',
  },
  {
    id: 'gip-tasks-11',
    role: 'gip',
    form: 'official',
    query: 'Создай задачу «Подготовить раздел КЖ» на Петрова в проекте «Северный»',
    expectedTools: ['directory.find_users', 'tasks.create'],
    forbiddenTools: ['tasks.list'],
    rationale:
      'Для исполнителя нужен id (directory.find_users), создаёт tasks.create; список задач ничего не создаёт.',
  },
  {
    id: 'gip-tasks-12',
    role: 'gip',
    form: 'colloquial',
    query: 'Перенеси срок задачи 1042 на 25 ноября',
    expectedTools: ['tasks.update'],
    forbiddenTools: ['tasks.transition'],
    rationale: 'Срок меняет tasks.update; переход меняет стадию, а не срок.',
  },
  {
    id: 'gip-no-tool-04',
    role: 'gip',
    form: 'official',
    query: 'Сформируй отчёт по трудозатратам по объекту «Северный» за октябрь',
    expectedTools: [],
    forbiddenTools: ['tasks.list'],
    noToolCase: true,
    rationale:
      'Отчёта по трудозатратам в каталоге нет: tasks.list даёт список задач, а не свод времени.',
  },
  {
    id: 'gip-no-tool-05',
    role: 'gip',
    form: 'colloquial',
    query: 'Сделай письмо в «Стройпроект», что акт согласован',
    expectedTools: [],
    forbiddenTools: ['letters.transition', 'chat.send'],
    noToolCase: true,
    rationale:
      'Создания и отправки письма нет; letters.transition двигает существующее, chat.send шлёт в чат.',
  },
];
