import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания инструментов справочника сотрудников и профиля (#926). */
export const directoryMeta = {
  'directory.find_users': {
    why: 'Найти id сотрудника, чтобы написать в личку, создать задачу или добавить в проект.',
    whenToUse:
      '«Найди сотрудника Петрова», «кто такой Петров», «напиши Петрову», «напиши в личку Ивановой», «добавь Петрова в проект», «создай задачу на Петрова» — сначала id человека.',
    whenNotToUse:
      'Не для своего профиля (me.get) и не для дерева отделов (directory.departments); карточку по id даёт directory.get_user.',
    subject: 'сотрудник',
    effect: 'read',
    example: { input: { query: 'Петров', limit: 10 }, note: 'поиск по фамилии' },
    returns: 'Сотрудники: ФИО, должность, подразделение, почта, id.',
    nextStep:
      'Передай id в directory.get_user, chat.direct_message, tasks.create или projects.add_member.',
    intent: 'search',
  },
  'directory.get_user': {
    why: 'Показать карточку сотрудника по id: контакты, должность, подразделение и руководитель.',
    whenToUse:
      '«Покажи карточку Петрова», «какая почта у Петрова» (после directory.find_users), «контакты сотрудника».',
    whenNotToUse:
      'Не для поиска по фамилии (directory.find_users) и не для своего профиля (me.get).',
    subject: 'сотрудник',
    effect: 'read',
    example: {
      input: { id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e' },
      note: 'id из directory.find_users',
    },
    returns: 'Карточка: ФИО, почта, телефон, город, кабинет, статус, id оргструктуры.',
    nextStep:
      'Для поиска других людей — directory.find_users; для личного сообщения — chat.direct_message.',
    intent: 'get',
  },
  'directory.departments': {
    why: 'Дерево подразделений с руководителями и численностью: юридическая и управленческая структура компании.',
    whenToUse:
      '«Покажи оргструктуру», «покажи структуру отделов», «юридическая структура», «кто руководит отделом проектирования», «какие отделы есть».',
    whenNotToUse:
      'Не для поиска сотрудника по фамилии (directory.find_users) и не для своего подразделения (me.get).',
    subject: 'подразделение',
    effect: 'read',
    example: { input: { kind: 'legal', limit: 60 }, note: 'юридическая структура компании' },
    returns: 'Дерево подразделений: названия, руководители, число сотрудников.',
    nextStep: 'Для людей из отдела — directory.find_users с departmentId.',
    intent: 'structure',
  },
  'me.get': {
    why: 'Показать профиль текущего сотрудника: своё подразделение, руководитель и подчинённые.',
    whenToUse:
      '«Кто мой руководитель», «в каком подразделении я работаю», «моя должность», «мои подчинённые», «кто я».',
    whenNotToUse:
      'Не для карточки другого сотрудника (directory.get_user) и не для поиска людей по фамилии (directory.find_users).',
    subject: 'профиль',
    effect: 'read',
    example: { input: {}, note: 'аргументов нет — профиль берётся из токена сотрудника' },
    returns: 'Профиль: ФИО, должность, путь подразделения, руководитель, подчинённые.',
    nextStep:
      'Для контактов коллег — directory.find_users; для оргструктуры — directory.departments.',
    intent: 'get',
  },
} satisfies Record<string, ToolStandard>;
