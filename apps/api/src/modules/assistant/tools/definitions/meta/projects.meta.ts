import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания инструментов проектов (#926). */
export const projectsMeta = {
  'projects.list': {
    why: 'Показать видимые проекты списком: мои или все, по статусу, роли и названию.',
    whenToUse:
      '«Какие проекты мне доступны», «покажи проекты», «найди проект Северный», «какие папки в структуре проекта» — сначала id проекта.',
    whenNotToUse:
      'Не для карточки проекта по id (projects.get), не для структуры (projects.structure) и не для участников (projects.members).',
    subject: 'проект',
    effect: 'read',
    example: {
      input: { scope: 'mine', status: 'active', limit: 10 },
      note: 'мои активные проекты',
    },
    returns: 'Строки проектов: название, шифр, статус, руководитель, число участников, id.',
    nextStep: 'Возьми id и вызови projects.get, projects.structure или projects.members.',
    intent: 'list',
  },
  'projects.get': {
    why: 'Показать карточку проекта по id: тип, статус, руководство, состав, заказчик и сроки.',
    whenToUse:
      '«Покажи карточку проекта Северный», «что за проект сейчас открыт» (после context.get), «расскажи о проекте».',
    whenNotToUse:
      'Не для списка проектов (projects.list) и не для структуры папок (projects.structure).',
    subject: 'проект',
    effect: 'read',
    example: {
      input: { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' },
      note: 'id из projects.list',
    },
    returns:
      'Карточка проекта: название, шифр, статус, руководитель, помощники, участники, заказчик, срок, описание, id.',
    nextStep:
      'Для разделов — projects.structure; для состава — projects.members; для ссылки — ui.open_entity.',
    intent: 'get',
  },
  'projects.structure': {
    why: 'Показать дерево структуры проекта: папки-разделы и файлы в них.',
    whenToUse:
      '«Покажи разделы проекта», «какие папки входят в структуру проекта», «что в проекте», «есть ли раздел или документ», «какая структура у проекта».',
    whenNotToUse:
      'Не для создания папки (projects.add_node) и не для списка видов папок (projects.node_kinds).',
    subject: 'структура',
    effect: 'read',
    example: {
      input: { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', limit: 40 },
      note: 'дерево разделов и файлов',
    },
    returns: 'Дерево: разделы, папки, имена файлов и количество.',
    nextStep: 'Для создания папки возьми kindId из projects.node_kinds и вызови projects.add_node.',
    intent: 'structure',
  },
  'projects.members': {
    why: 'Показать состав проекта с ролями: руководитель, помощники, участники, наблюдатели.',
    whenToUse:
      '«Кто в проекте», «покажи состав участников проекта», «кто отвечает за раздел», «кто наблюдатель в проекте».',
    whenNotToUse:
      'Не для добавления участника (projects.add_member) и не для карточки сотрудника (directory.get_user).',
    subject: 'участник',
    alsoSubjects: ['проект'],
    effect: 'read',
    example: {
      input: { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', limit: 30 },
      note: 'состав проекта с ролями',
    },
    returns: 'Люди проекта с ролями.',
    nextStep:
      'Для контактов сотрудника — directory.get_user; для добавления — projects.add_member.',
    intent: 'members',
  },
  'projects.update': {
    why: 'Изменить название или описание существующего проекта.',
    whenToUse:
      '«Переименуй проект Речной в Речной-2», «измени описание проекта», «поправь название договора».',
    whenNotToUse:
      'Не для создания проекта (projects.create) и не для папок структуры (projects.add_node).',
    subject: 'проект',
    effect: 'irreversible',
    example: {
      input: { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', name: 'Речной-2' },
      note: 'новое название; null в description очищает описание',
    },
    returns: 'Карточка подтверждения; после выполнения — обновлённое название и id.',
    nextStep:
      'Покажи новое название; для остальных полей проекта используй соответствующую карточку.',
    intent: 'update',
  },
  'projects.add_member': {
    why: 'Добавить сотрудника с ролью наблюдателя или полного доступа.',
    whenToUse:
      '«Добавь Петрова наблюдателем», «включи сотрудника с ролью наблюдателя», «сделай наблюдателем».',
    whenNotToUse:
      'Не для показа состава (projects.members) и не для правки проекта (projects.update); сотрудника найди через directory.find_users.',
    subject: 'участник',
    alsoSubjects: ['проект'],
    effect: 'write',
    example: {
      input: {
        id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        userId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
        kind: 'observer',
      },
      note: 'наблюдатель; member — участник',
    },
    returns: 'Карточка подтверждения; после выполнения — участник добавлен, id проекта.',
    nextStep:
      'Для проверки состава — projects.members; для личного сообщения — chat.direct_message.',
    intent: 'create',
  },
  'projects.add_node': {
    why: 'Создать папку в структуре проекта по виду (kindId) с названием и родителем.',
    whenToUse:
      '«Создай папку Рабочая документация в проекте Северный», «добавь раздел в структуру проекта», «новая папка в проекте».',
    whenNotToUse:
      'Не для просмотра структуры (projects.structure) и не для добавления участника (projects.add_member); kindId — из projects.node_kinds.',
    subject: 'папка',
    effect: 'write',
    example: {
      input: {
        id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        name: 'Рабочая документация',
        kindId: '3c4d5e6f-7a8b-4c9d-9e0f-1a2b3c4d5e6f',
      },
      note: 'родительская папка — parentId, если нужна вложенность',
    },
    returns: 'Карточка подтверждения; после выполнения — название папки и id.',
    nextStep: 'Покажи папку в структуре проекта (projects.structure).',
    intent: 'create',
  },
} satisfies Record<string, ToolStandard>;
