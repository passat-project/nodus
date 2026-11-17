import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания действий с сообщениями (#929). */
export const chatMessagesMeta = {
  'chat.edit_message': {
    why: 'Изменить текст своего сообщения в беседе.',
    whenToUse: '«Исправь сообщение», «поправь текст в чате», «добавь вложение к сообщению».',
    whenNotToUse: 'Не для нового сообщения (chat.send) и не для удаления (его в ассистенте нет).',
    subject: 'сообщение',
    effect: 'irreversible',
    example: {
      input: {
        conversationId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        messageId: '7c2f3b4d-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
        text: 'Исправленный текст',
      },
      note: 'править можно только своё сообщение в пределах прав API',
    },
    returns: 'Карточка подтверждения; после выполнения — новый текст и ссылка на беседу.',
    nextStep: 'Если правка не нужна, вернись к чтению chat.messages.',
    intent: 'update',
  },
  'chat.pin_message': {
    why: 'Закрепить важное сообщение в ленте закрепов беседы.',
    whenToUse: '«Закрепи сообщение», «добавь в закрепы», «важное сообщение в чате».',
    whenNotToUse: 'Не для открепа (chat.unpin_message) и не для реакции (chat.react).',
    subject: 'сообщение',
    effect: 'write',
    example: {
      input: {
        conversationId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        messageId: '7c2f3b4d-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      },
      note: 'закреп идемпотентен',
    },
    returns: 'Карточка подтверждения; после выполнения — текст сообщения и ссылка на беседу.',
    nextStep: 'Покажи закрепы, если сотрудник просит список важного.',
    intent: 'update',
  },
  'chat.unpin_message': {
    why: 'Убрать сообщение из ленты закрепов беседы.',
    whenToUse: '«Открепи сообщение», «убери из закрепов», «больше не важно».',
    whenNotToUse:
      'Не для закрепа (chat.pin_message) и не для удаления сообщения (его в ассистенте нет).',
    subject: 'сообщение',
    effect: 'irreversible',
    example: {
      input: {
        conversationId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        messageId: '7c2f3b4d-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
      },
      note: 'сообщение остаётся в ленте',
    },
    returns: 'Карточка подтверждения; после выполнения — подтверждение открепа.',
    nextStep: 'Закрепи другое сообщение, если сотрудник просит.',
    intent: 'update',
  },
  'chat.react': {
    why: 'Поставить или снять свою эмодзи-реакцию на сообщение.',
    whenToUse: '«Поставь лайк», «отреагируй 👍», «сними реакцию».',
    whenNotToUse: 'Не для ответа текстом (chat.send) и не для закрепа (chat.pin_message).',
    subject: 'сообщение',
    effect: 'write',
    example: {
      input: {
        conversationId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        messageId: '7c2f3b4d-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
        emoji: '👍',
      },
      note: 'remove: true — снять свою реакцию',
    },
    returns: 'Карточка подтверждения; после выполнения — какая реакция поставлена/снята.',
    nextStep: 'Ответь текстом, если реакции недостаточно.',
    intent: 'create',
  },
  'chat.forward_message': {
    why: 'Переслать сообщения из одной беседы в другую.',
    whenToUse: '«Перешли в другой чат», «скинь это в группу», «переслать сообщение».',
    whenNotToUse: 'Не для нового сообщения (chat.send) и не для копирования файла вне чата.',
    subject: 'сообщение',
    effect: 'irreversible',
    example: {
      input: {
        conversationId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d',
        sourceConversationId: '7c2f3b4d-5e6a-4b7c-8d9e-0f1a2b3c4d5e',
        messageIds: ['8d3a4c5e-6f7b-4c8d-9e0f-1a2b3c4d5e6f'],
      },
      note: 'conversationId — целевая беседа',
    },
    returns: 'Карточка подтверждения; после выполнения — число пересланных и ссылка на беседу.',
    nextStep: 'Добавь комментарий отдельным сообщением, если нужно.',
    intent: 'send',
  },
} satisfies Record<string, ToolStandard>;
