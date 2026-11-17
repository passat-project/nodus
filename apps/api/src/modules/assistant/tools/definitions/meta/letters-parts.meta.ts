import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания действий по письмам (#930). */
export const lettersPartsMeta = {
  'letters.actions': {
    why: 'Показать кнопки действий письма без смены статуса, чтобы нажать нужную, а не угадывать.',
    whenToUse: '«Какие действия по письму», «что можно нажать», перед letters.press_action.',
    whenNotToUse: 'Не для переходов статуса (letters.transitions/letters.transition).',
    subject: 'письмо',
    effect: 'read',
    example: {
      input: { letterId: '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f' },
      note: 'действия без смены статуса',
    },
    returns: 'Кнопки: название, id, блокировка и наличие окна ввода.',
    nextStep: 'Передай id действия в letters.press_action; при окне заполни form.',
    intent: 'transitions',
  },
  'letters.history': {
    why: 'Показать историю письма: кто, когда и что менял, регистрацию и переходы.',
    whenToUse: '«История письма», «кто менял», «что было с письмом», «когда зарегистрировали».',
    whenNotToUse:
      'Не для текущих переходов (letters.transitions) и не для связей (letters.relations).',
    subject: 'письмо',
    effect: 'read',
    example: {
      input: { letterId: '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f', limit: 30 },
      note: 'история постранично',
    },
    returns: 'События: дата, автор, тип изменения и подробности.',
    nextStep: 'При необходимости открой карточку письма или связи.',
    intent: 'history',
  },
  'letters.update': {
    why: 'Исправить реквизиты письма: тему, номер и дату корреспондента, срок, контрагента, конфиденциальность.',
    whenToUse:
      '«Исправь тему письма», «поставь срок ответа», «поменяй контрагента», «сделай конфиденциальным».',
    whenNotToUse:
      'Не для регистрации и резолюции (letters.transition) и не для смены основного документа.',
    subject: 'письмо',
    effect: 'irreversible',
    example: {
      input: {
        letterId: '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f',
        patch: { subject: 'Акт согласован' },
      },
      note: 'patch — поля updateLetterBodySchema; номер так не меняется',
    },
    returns: 'Карточка подтверждения; после выполнения — письмо с новыми реквизитами.',
    nextStep: 'Покажи карточку письма или историю изменений.',
    intent: 'update',
  },
  'letters.set_main_document': {
    why: 'Отметить звёздочкой основной документ письма до регистрации.',
    whenToUse: '«Сделай основной документ акт», «помечу звездой вложение», «главный файл письма».',
    whenNotToUse:
      'Не для чтения вложений (letters.attachments) и не после регистрации (выбор заморожен).',
    subject: 'вложение',
    alsoSubjects: ['письмо'],
    effect: 'irreversible',
    example: {
      input: {
        letterId: '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f',
        attachmentId: '6d7e8f9a-0b1c-4d2e-9f3a-4b5c6d7e8f9a',
      },
      note: 'attachmentId — из letters.attachments',
    },
    returns: 'Карточка подтверждения; после выполнения — письмо с основным документом.',
    nextStep: 'Проверь вложения письма, если документов несколько.',
    intent: 'update',
  },
  'letters.add_participant': {
    why: 'Пригласить коллег в обсуждение письма.',
    whenToUse: '«Пригласи Петрова в обсуждение письма», «добавь коллегу к письму».',
    whenNotToUse:
      'Не для присоединения самого сотрудника (letters.join) и не для участников проекта.',
    subject: 'участник',
    alsoSubjects: ['письмо'],
    effect: 'irreversible',
    example: {
      input: {
        letterId: '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f',
        userIds: ['7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b'],
      },
      note: 'до 20 сотрудников за карточку',
    },
    returns: 'Карточка подтверждения; после выполнения — письмо и ссылка на него.',
    nextStep: 'Отправь сообщение в чат письма, если нужно.',
    intent: 'create',
  },
  'letters.join': {
    why: 'Присоединиться к обсуждению письма, чтобы видеть его чат и участников.',
    whenToUse: '«Присоединись к обсуждению письма», «добавь меня к письму», «хочу в обсуждение».',
    whenNotToUse: 'Не для приглашения других (letters.add_participant).',
    subject: 'письмо',
    effect: 'irreversible',
    example: { input: { letterId: '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f' }, note: 'идемпотентно' },
    returns: 'Карточка подтверждения; после выполнения — письмо и ссылка на него.',
    nextStep: 'Открой чат письма, если сотрудник хочет написать участникам.',
    intent: 'update',
  },
  'letters.add_relation': {
    why: 'Связать письмо с другим: «ответ на» или «вложено в».',
    whenToUse: '«Свяжи письма», «это ответ на письмо», «вложено в письмо», «одна ёлочка».',
    whenNotToUse: 'Не для просмотра связей (letters.relations) и не для приложенных файлов.',
    subject: 'связь',
    alsoSubjects: ['письмо'],
    effect: 'irreversible',
    example: {
      input: {
        letterId: '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f',
        relatedLetterId: '6d7e8f9a-0b1c-4d2e-9f3a-4b5c6d7e8f9a',
        kind: 'reply_to',
      },
      note: 'kind: reply_to (ответ на) или nested_in (вложено в)',
    },
    returns: 'Карточка подтверждения; после выполнения — письмо и ссылка на него.',
    nextStep: 'Покажи дерево связей letters.relations.',
    intent: 'create',
  },
  'letters.press_action': {
    why: 'Нажать кнопку действия письма: данные окна фиксируются, статус не меняется.',
    whenToUse: '«Нажми Ознакомить», «выполни действие по письму», после letters.actions.',
    whenNotToUse: 'Не для смены статуса (letters.transition) и не для регистрации.',
    subject: 'письмо',
    effect: 'irreversible',
    example: {
      input: {
        letterId: '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f',
        actionId: '7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b',
        reason: 'Ознакомлен',
      },
      note: 'поля окна действия — form, причина — reason',
    },
    returns: 'Карточка подтверждения; после выполнения — письмо и ссылка на него.',
    nextStep: 'Покажи историю письма или предложи следующий переход.',
    intent: 'transition',
  },
} satisfies Record<string, ToolStandard>;
