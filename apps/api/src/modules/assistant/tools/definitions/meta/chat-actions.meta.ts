import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания действий с беседами (#929). */
export const chatActionsMeta = {
  'chat.members': {
    why: 'Показать участников беседы с ролями и id, чтобы выбрать адресата действия.',
    whenToUse: '«Кто в беседе», «покажи состав группы», нужен userId для добавления или роли.',
    whenNotToUse: 'Не для списка бесед (chat.conversations) и не для сообщений (chat.messages).',
    subject: 'участник',
    alsoSubjects: ['чат'],
    effect: 'read',
    example: { input: { id: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d' }, note: 'участники с ролями' },
    returns: 'Список участников: имя, роль, дата вступления, id сотрудника.',
    nextStep: 'Возьми userId для chat.add_members или chat.set_member_role.',
    intent: 'members',
  },
  'chat.create_conversation': {
    why: 'Создать группу или канал проекта для рабочей переписки.',
    whenToUse: '«Создай группу „Сметчики“», «заведи чат по объекту», «новый канал проекта».',
    whenNotToUse:
      'Не для личного чата (chat.direct_message) и не для чата задачи (он создаётся системой).',
    subject: 'беседа',
    effect: 'irreversible',
    example: {
      input: { type: 'group', title: 'Сметчики' },
      note: 'type: group или project_channel',
    },
    returns: 'Карточка подтверждения; после выполнения — название, id и ссылка на беседу.',
    nextStep: 'Добавь участников через chat.add_members или отправь первое сообщение.',
    intent: 'create',
  },
  'chat.add_members': {
    why: 'Добавить сотрудников в группу или канал.',
    whenToUse: '«Добавь Петрова в группу», «пригласи Иванову в беседу», «включи в канал».',
    whenNotToUse:
      'Не для личного чата (состав фиксирован) и не для смены роли (chat.set_member_role).',
    subject: 'участник',
    alsoSubjects: ['чат'],
    effect: 'irreversible',
    example: {
      input: {
        conversationId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        userIds: ['7c2f3b4d-5e6a-4b7c-8d9e-0f1a2b3c4d5e'],
      },
      note: 'до 100 сотрудников за карточку',
    },
    returns: 'Карточка подтверждения; после выполнения — число добавленных и ссылка на беседу.',
    nextStep: 'Отправь приветственное сообщение через chat.send, если уместно.',
    intent: 'create',
  },
  'chat.set_member_role': {
    why: 'Назначить участнику роль модератора или вернуть обычную роль.',
    whenToUse: '«Сделай Петрова модератором», «сними права модератора», «помоги вести группу».',
    whenNotToUse: 'Не для добавления участника (chat.add_members) и не для ролей портала (админ).',
    subject: 'участник',
    alsoSubjects: ['чат'],
    effect: 'irreversible',
    example: {
      input: {
        conversationId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        userId: '7c2f3b4d-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
        role: 'admin',
      },
      note: 'role: admin (модератор) или member',
    },
    returns: 'Карточка подтверждения; после выполнения — имя сотрудника и новая роль.',
    nextStep: 'Проверь участников через chat.members, если меняли нескольких.',
    intent: 'update',
  },
  'chat.save_draft': {
    why: 'Сохранить черновик сообщения в беседе, не отправляя его.',
    whenToUse: '«Подготовь ответ, но не отправляй», «сохрани черновик», «набросай текст».',
    whenNotToUse:
      'Не для отправки (chat.send) и не для правки уже отправленного (chat.edit_message).',
    subject: 'сообщение',
    effect: 'irreversible',
    example: {
      input: {
        conversationId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        text: 'Добрый день! Смета проверена…',
      },
      note: 'черновик виден только сотруднику',
    },
    returns: 'Карточка подтверждения; после выполнения — длина черновика и ссылка на беседу.',
    nextStep: 'Сотрудник отправит черновик сам или попросит chat.send.',
    intent: 'create',
  },
} satisfies Record<string, ToolStandard>;
