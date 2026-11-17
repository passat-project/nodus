import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания инструментов мессенджера (#926). */
export const chatMeta = {
  'chat.conversations': {
    why: 'Показать беседы сотрудника: найти чат по названию, чтобы отправить сообщение или прочитать переписку.',
    whenToUse:
      '«Покажи мои беседы», «что писали в беседе Отдел», «беседы с непрочитанными», «найди личный чат с Ивановой», «отправь сообщение в беседу».',
    whenNotToUse:
      'Не для сообщений конкретной беседы (chat.messages) и не для чата задачи по id (chat.task_conversation).',
    subject: 'чат',
    effect: 'read',
    example: { input: { scope: 'all', limit: 20 }, note: 'все беседы с непрочитанными' },
    returns: 'Строки бесед: название, тип, участники, непрочитанные, активность, id.',
    nextStep:
      'Возьми id беседы и вызови chat.messages или chat.send; для лички — chat.direct_message.',
    intent: 'list',
  },
  'chat.messages': {
    why: 'Показать последние сообщения чата: автор, время, текст и вложения.',
    whenToUse: '«Что писали в чате», «о чём договорились», «кто ответил», «переписка в чате».',
    whenNotToUse:
      'Не для списка бесед (chat.conversations), не для отправки (chat.send) и не для чата задачи по id (chat.task_conversation).',
    subject: 'сообщение',
    effect: 'read',
    example: {
      input: { conversationId: '8b9c0d1e-2f3a-4b5c-9d6e-7f8a9b0c1d2e', limit: 20 },
      note: 'последние сообщения беседы',
    },
    returns: 'Сообщения: время, автор, текст, вложения с fileId.',
    nextStep: 'Для ответа — chat.send; для чтения вложения — files.extract_text.',
    intent: 'list',
  },
  'chat.task_conversation': {
    why: 'Найти или открыть беседу задачи, чтобы прочитать сообщения или отправить ответ.',
    whenToUse:
      '«Что в чате задачи 1042», «отправь в чат задачи», «обсуждение задачи» — возвращает id беседы для chat.messages и chat.send.',
    whenNotToUse:
      'Не для списка всех бесед (chat.conversations) и не для личного чата с сотрудником (chat.direct_message).',
    subject: 'чат',
    effect: 'read',
    example: {
      input: { taskId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d' },
      note: 'беседа задачи; создаётся порталом при первом открытии',
    },
    returns: 'Беседа задачи: название и id для следующих шагов.',
    nextStep: 'Передай id в chat.messages или chat.send.',
    intent: 'get',
  },
  'chat.send': {
    why: 'Отправить сообщение в существующий чат или чат задачи.',
    whenToUse: '«Отправь сообщение в чат Приёмная», «напиши в чат задачи», «ответь в чате».',
    whenNotToUse:
      'Не для личного сообщения сотруднику (chat.direct_message) и не для чтения переписки (chat.messages).',
    subject: 'сообщение',
    effect: 'write',
    example: {
      input: {
        conversationId: '8b9c0d1e-2f3a-4b5c-9d6e-7f8a9b0c1d2e',
        text: 'Акт готов',
      },
      note: 'сообщение в найденную беседу',
    },
    returns: 'Карточка подтверждения; после выполнения — сообщение отправлено и его id.',
    nextStep: 'Если нужен ответ — прочитай сообщения через chat.messages.',
    intent: 'send',
  },
  'chat.direct_message': {
    why: 'Написать сотруднику в личные сообщения, при необходимости создав личный чат.',
    whenToUse:
      '«Напиши Петрову в личку», «отправь личное сообщение Ивановой», «напиши сотруднику лично».',
    whenNotToUse:
      'Не для сообщения в общую беседу (chat.send) и не для группового чата; сотрудника найди через directory.find_users.',
    subject: 'личное сообщение',
    effect: 'write',
    example: {
      input: {
        userId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
        text: 'Совещание переносится',
      },
      note: 'личный чат: существующий или новый',
    },
    returns: 'Карточка подтверждения; после выполнения — личное сообщение отправлено и id беседы.',
    nextStep: 'Для продолжения диалога — chat.messages по id беседы.',
    intent: 'send',
  },
} satisfies Record<string, ToolStandard>;
