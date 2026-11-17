import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания действий проекта (#931): завершение, участие, папки. */
export const projectsPartsMeta = {
  'projects.set_status': {
    why: 'Завершить проект или вернуть его в работу (без архивации).',
    whenToUse: '«Заверши проект», «отметь проект завершённым», «верни проект в работу».',
    whenNotToUse:
      'Не для архивации (через ассистента недоступна) и не для переименования (projects.update).',
    subject: 'проект',
    effect: 'irreversible',
    example: {
      input: { projectId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', status: 'completed' },
      note: 'status: completed или active; archived — только в интерфейсе',
    },
    returns: 'Карточка подтверждения; после выполнения — статус проекта и ссылка.',
    nextStep: 'Покажи карточку проекта или список проектов.',
    intent: 'transition',
  },
  'projects.join': {
    why: 'Присоединиться к открытому проекту наблюдателем.',
    whenToUse: '«Присоединись к проекту», «добавь меня в проект», «хочу наблюдать за проектом».',
    whenNotToUse: 'Не для приглашения других (projects.add_member).',
    subject: 'проект',
    effect: 'irreversible',
    example: { input: { projectId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' }, note: 'идемпотентно' },
    returns: 'Карточка подтверждения; после выполнения — подтверждение и ссылка на проект.',
    nextStep: 'Открой проект, если сотрудник хочет работать со структурой.',
    intent: 'update',
  },
  'projects.leave': {
    why: 'Покинуть проект, в который сотрудник вступил наблюдателем.',
    whenToUse: '«Покинь проект», «выйди из проекта», «убери меня из наблюдателей».',
    whenNotToUse:
      'Не для удаления участника другим человеком (в ассистенте нет) и не для архивации.',
    subject: 'проект',
    effect: 'irreversible',
    example: {
      input: { projectId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' },
      note: 'только свой ряд вступившего',
    },
    returns: 'Карточка подтверждения; после выполнения — подтверждение и ссылка на проект.',
    nextStep: 'Предложи присоединиться снова, если сотрудник передумает.',
    intent: 'update',
  },
  'projects.update_group': {
    why: 'Переименовать портфель (группу журнала проектов).',
    whenToUse: '«Переименуй портфель», «переименуй группу проектов», «поправь название портфеля».',
    whenNotToUse: 'Не для создания портфеля (projects.create_group) и не для переноса проекта.',
    subject: 'портфель',
    effect: 'irreversible',
    example: {
      input: { groupId: '3c4d5e6f-7a8b-4c9d-9e0f-1a2b3c4d5e6f', patch: { name: 'Жилые объекты' } },
      note: 'новое имя до 120 знаков',
    },
    returns: 'Карточка подтверждения; после выполнения — новое имя портфеля.',
    nextStep: 'Покажи портфели, если сотрудник сверяет список.',
    intent: 'update',
  },
  'projects.update_node': {
    why: 'Переименовать папку проекта, сменить шифр или вид папки.',
    whenToUse: '«Переименуй папку», «поправь шифр папки», «смени вид папки».',
    whenNotToUse:
      'Не для создания папки (projects.add_node) и не для переноса (projects.move_node).',
    subject: 'папка',
    effect: 'irreversible',
    example: {
      input: {
        projectId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        nodeId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
        patch: { name: 'Рабочая документация' },
      },
      note: 'patch — updateProjectNodeBodySchema; смена вида может выдать номер',
    },
    returns: 'Карточка подтверждения; после выполнения — папка с новыми значениями.',
    nextStep: 'Покажи структуру проекта, если сотрудник сверяет дерево.',
    intent: 'update',
  },
  'projects.move_node': {
    why: 'Перенести папку проекта в другого родителя или на другую позицию.',
    whenToUse: '«Перенеси папку в …», «перемести раздел», «сделай папку вложенной в …».',
    whenNotToUse: 'Не для переименования (projects.update_node) и не для создания папки.',
    subject: 'папка',
    effect: 'irreversible',
    example: {
      input: {
        projectId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        nodeId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
        parentId: null,
      },
      note: 'parentId=null — корень проекта; beforeId/afterId — позиция среди детей',
    },
    returns: 'Карточка подтверждения; после выполнения — папка в новом месте.',
    nextStep: 'Покажи структуру проекта, чтобы сотрудник увидел новое место.',
    intent: 'update',
  },
} satisfies Record<string, ToolStandard>;
