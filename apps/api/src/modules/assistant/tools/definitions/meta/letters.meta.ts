import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания инструментов корреспонденции (#926). */
export const lettersMeta = {
  'letters.list': {
    why: 'Показать реестр писем: входящие, исходящие и новые, с поиском по теме, номеру и корреспонденту.',
    whenToUse:
      '«Покажи входящие письма», «что пришло нового», «письма по объекту Северный», «письмо 128», «реестр исходящих».',
    whenNotToUse:
      'Не для карточки письма, когда id уже известен (letters.get), и не для резолюции (letters.transition).',
    subject: 'письмо',
    effect: 'read',
    example: { input: { box: 'incoming', limit: 10 }, note: 'входящие письма за сегодня' },
    returns: 'Строки писем: номер, тема, направление, стадия, корреспондент, срок, id.',
    nextStep: 'Возьми id и вызови letters.get, letters.attachments или letters.transitions.',
    intent: 'list',
  },
  'letters.get': {
    why: 'Показать карточку письма по id: номер, тема, корреспондент, стадия, срок и вложения.',
    whenToUse: '«Открой карточку письма №128», «что там в письме 128», «покажи карточку письма».',
    whenNotToUse:
      'Не для реестра и поиска номера (letters.list) и не для доступных кнопок маршрута (letters.transitions).',
    subject: 'письмо',
    effect: 'read',
    example: {
      input: { id: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a' },
      note: 'id из letters.list',
    },
    returns:
      'Карточка письма: номер, тема, направление, стадия, корреспондент, адресат, даты, вложения, id.',
    nextStep:
      'Для текста вложения — files.extract_text по fileId; для резолюции — letters.transitions.',
    intent: 'get',
  },
  'letters.transitions': {
    why: 'Показать доступные кнопки маршрута письма: куда перевести, какие гейты не пройдены.',
    whenToUse:
      '«Что дальше можно сделать с письмом», «какие кнопки у письма», «можно ли зарегистрировать письмо», «что дальше с письмом».',
    whenNotToUse:
      'Не для выполнения перехода (letters.transition) и не для карточки письма (letters.get).',
    subject: 'письмо',
    effect: 'read',
    example: {
      input: { id: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a' },
      note: 'доступные кнопки маршрута',
    },
    returns: 'Переходы с названием, целевой стадией, блокировками и возможностью обхода.',
    nextStep: 'Выбери переход и вызови letters.transition с его id.',
    intent: 'transitions',
  },
  'letters.relations': {
    why: 'Показать связанные письма: ответы, цепочку переписки и приложенные номера.',
    whenToUse: '«Есть ли ответ на письмо», «вся переписка по вопросу», «покажи цепочку писем».',
    whenNotToUse:
      'Не для описи вложений (letters.attachments) и не для карточки письма (letters.get).',
    subject: 'связь',
    effect: 'read',
    example: {
      input: { id: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a' },
      note: 'дерево ответов и цепочки',
    },
    returns: 'Дерево связанных писем: номер, тема, тип связи.',
    nextStep: 'Открой нужное письмо через letters.get.',
    intent: 'relations',
  },
  'letters.attachments': {
    why: 'Показать опись вложений письма: имена, форматы, размер и fileId для чтения текста.',
    whenToUse:
      '«Покажи вложения письма», «какие вложения в письме», «прочитай, что в приложенном акте» — сначала опись и fileId, затем files.extract_text.',
    whenNotToUse:
      'Не для чтения текста документа (files.extract_text) и не для карточки письма (letters.get).',
    subject: 'вложение',
    effect: 'read',
    example: {
      input: { id: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a' },
      note: 'опись вложений письма',
    },
    returns: 'Вложения: имя, формат, размер, роль, fileId.',
    nextStep: 'Передай fileId в files.extract_text, чтобы прочитать PDF или DOCX.',
    intent: 'attachments',
  },
  'letters.transition': {
    why: 'Выполнить переход: резолюция с поручением, регистрация или следующий шаг маршрута.',
    whenToUse:
      '«Поставь резолюцию на Петрова», «зарегистрируй», «переведи дальше» — сначала letters.transitions.',
    whenNotToUse:
      'Не для чтения доступных кнопок (letters.transitions), не для создания задачи (tasks.create) и не для отправки письма (такого инструмента нет).',
    subject: 'письмо',
    effect: 'irreversible',
    example: {
      input: {
        letterId: '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a',
        transitionId: '5e6f7a8b-9c0d-4e1f-9a2b-3c4d5e6f7a8b',
        description: 'Подготовить ответ',
        assigneeId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
      },
      note: 'переход «Резолюция» из letters.transitions',
    },
    returns: 'Карточка подтверждения; после выполнения — письмо, новая стадия и id.',
    nextStep: 'Сообщи новую стадию; при необходимости открой письмо через letters.get.',
    intent: 'transition',
  },
} satisfies Record<string, ToolStandard>;
